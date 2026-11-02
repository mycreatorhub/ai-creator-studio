const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mycreatorhub.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respond({ error: "Use POST for content generation." }, 405);
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!apiKey || !supabaseUrl || !supabaseAnonKey) {
      return respond({ error: "Server configuration is incomplete." }, 500);
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return respond({
        error: "Please sign in before generating content."
      }, 401);
                   }
    // Verify the signed-in user
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        "Authorization": authHeader,
        "apikey": supabaseAnonKey,
      },
    });

    if (!userResponse.ok) {
      return respond({
        error: "Your session is invalid. Please refresh the app."
      }, 401);
    }

    // Read and validate the request
    const body = await req.json();

    const topic = String(body.topic ?? "").trim();
    const format = String(body.format ?? "General");
    const language = String(body.language ?? "Tagalog");
    const duration = Number(body.duration ?? 60);
    const secondsPerScene = Number(body.secondsPerScene ?? 10);

    if (!topic || topic.length > 500) {
      return respond({
        error: "Enter a topic (maximum 500 characters)."
      }, 400);
    }

    if (![30, 60, 90, 120].includes(duration)) {
      return respond({ error: "Invalid video duration." }, 400);
    }

    if (![5, 10, 15].includes(secondsPerScene)) {
      return respond({ error: "Invalid scene length." }, 400);
    }

    const sceneCount = Math.ceil(duration / secondsPerScene);

    // Check and consume the user's generation allowance
    const limitResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/check_generation_limit`,
      {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "apikey": supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );

    if (!limitResponse.ok) {
      console.error(
        "Usage limit check failed:",
        await limitResponse.text()
      );

      return respond({
        error: "Could not check your generation limit. Please try again."
      }, 500);
    }
    const limit = await limitResponse.json();

    if (!limit.allowed) {
      const message = limit.is_anonymous
        ? "You've used your 2 free guest generations. Please sign up to unlock 5 free generations every day."
        : "You've used all 5 free generations today. Please try again tomorrow.";

      return respond({
        error: message,
        remaining: 0,
        is_anonymous: limit.is_anonymous,
      }, 429);
    }

    // Build the AI generation prompt
    const prompt = `You are the professional AI writing assistant for AI Creator Studio.

TOPIC: ${topic}
CONTENT FORMAT: ${format}
LANGUAGE: ${language}
TOTAL DURATION: ${duration} seconds
SCENE LENGTH: approximately ${secondsPerScene} seconds
NUMBER OF SCENES: exactly ${sceneCount}

Create a detailed, engaging, original short-form video plan.

Include:
1. Catchy title.
2. Powerful opening hook.
3. Full narration script.
4. Narrator description, voice and delivery instructions.
5. Exactly ${sceneCount} numbered scenes.
6. For every scene: duration, visual description, camera movement, cinematic video-generation prompt, and narration.
7. Closing call to action.

Keep the scene durations equal to ${duration} seconds in total.
Make narration natural and engaging.
For documentaries, distinguish verified facts from speculation. Never invent historical facts.
For Philippine history, use accurate dates, names and locations.`;

    // Generate content using Gemini
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 8192,
          },
        }),
      },
    );

    const result = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", result);

      return respond({
        error: "Gemini could not generate content. Please try again later.",
      }, 502);
    }

    const generatedText =
      result.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? "")
        .join("") ?? "";

    if (!generatedText) {
      return respond({
        error: "Gemini returned an empty response."
      }, 502);
    }
    return respond({
      success: true,
      content: generatedText,
      sceneCount,
      duration,
      remaining: limit.remaining,
      limit: limit.limit,
      is_anonymous: limit.is_anonymous,
    });

  } catch (error) {
    console.error("Function error:", error);

    return respond({
      error: "Something went wrong. Please try again."
    }, 500);
  }
});
