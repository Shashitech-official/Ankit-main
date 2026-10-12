import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';

export const apiRouter = Router();

function resolveGeminiApiKey(): string | null {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.NETLIFY_GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    '';
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return key;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check endpoint
apiRouter.get('/health', (req, res) => {
  const apiKey = resolveGeminiApiKey();
  const isConfigured = Boolean(apiKey);
  res.json({
    configured: isConfigured,
    model: 'gemini-3.8-flash',
    provider: 'Google Gemini',
    availableModels: [
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tag: 'Fast & Intelligent' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', tag: 'Complex Reasoning' },
    ],
  });
});

// Chat endpoint
apiRouter.post('/chat', async (req, res) => {
  try {
    const {
      message = '',
      mode = 'chat',
      expert = false,
      history = [],
      attachments = [],
      model = 'gemini-3.8-flash',
    } = req.body;

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: `Gemini API key is not configured in Netlify.

### How to configure on Netlify:
1. **Open Netlify Site Configuration**:
   Navigate to **Site configuration > Environment variables** in your Netlify dashboard.
2. **Add Variable**:
   - **Key**: \`GEMINI_API_KEY\`
   - **Value**: Your Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
   - **Scope**: Ensure **Functions** (or **All scopes**) is checked.
3. **Trigger a New Deploy**:
   Go to the **Deploys** tab in Netlify, click **Trigger deploy**, and select **Clear cache and deploy site**. *(Environment variables only apply to serverless functions on a new deploy!)*`,
      });
    }

    // Determine system instructions with creator and model identity
    const identityRule = 'You are Abs AI, a creative intelligence assistant developed and made by Ankit. If anyone asks who made you, who created you, or who built you, always state clearly that you were made by Ankit. When asked what models, engine, or API you use, state that you are powered by Google Gemini (such as Gemini 3.8 Flash and Gemini 3.1 Pro via the Gemini API).';

    let systemInstruction = `${identityRule} Be articulate, helpful, structured, and insightful. Use rich Markdown format with headings, bullet points, and code formatting when appropriate.`;
    
    if (mode === 'code') {
      systemInstruction = `${identityRule} You are Abs AI Dev Assistant, an elite senior software architect and programmer. Provide accurate, clean, production-ready code with complete syntax highlighting, explain edge cases, and describe algorithmic complexity when relevant.`;
    } else if (mode === 'image') {
      systemInstruction = `${identityRule} You are Abs AI Image Studio. You are an expert art director and creative visual designer. When describing images or art prompts, break down subject, lighting, color palette, camera lens, perspective, and composition. If the user asks for a diagram or graphic, you can also output clean inline SVG code wrapped in an \`\`\`xml or \`\`\`svg code block so it can be previewed directly.`;
    } else if (mode === 'reply') {
      systemInstruction = `${identityRule} You are Abs AI Reply Writer. You excel at crafting perfect responses for messages, emails, chats, or PRs. Provide 2 to 3 distinct response variations (e.g., 1. Warm & Friendly, 2. Concise & Direct, 3. Polished & Professional) so the user can choose the best tone.`;
    } else if (mode === 'files') {
      systemInstruction = `${identityRule} You are Abs AI File & Document Analyst. Carefully review and dissect all provided document context, attachments, or code files. Synthesize the core information, highlight key metrics or quotes, and provide precise answers.`;
    }

    if (expert) {
      systemInstruction += ' [EXPERT MODE ACTIVE: Employ deep multi-step reasoning, verify assumptions, cross-reference possible failure modes, and provide exhaustive high-level rigor.]';
    }

    // Prepare contents payload
    const parts: any[] = [];

    // Handle attachments (images, PDFs, text files)
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const file of attachments) {
        if (!file.data) continue;
        const mimeType = file.mimeType || 'application/octet-stream';
        
        if (
          mimeType.startsWith('image/') ||
          mimeType === 'application/pdf' ||
          mimeType.startsWith('audio/')
        ) {
          parts.push({
            inlineData: {
              mimeType,
              data: file.data,
            },
          });
        } else {
          try {
            const decoded = Buffer.from(file.data, 'base64').toString('utf-8');
            parts.push({
              text: `\n[Attached File: ${file.name || 'document'}]\n\`\`\`\n${decoded.slice(0, 50000)}\n\`\`\`\n`,
            });
          } catch {
            parts.push({
              text: `[Attached file ${file.name || 'binary'}]`,
            });
          }
        }
      }
    }

    // Include recent history context
    let conversationContext = '';
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-6);
      conversationContext = 'Previous context:\n' + recent.map((item: any) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`).join('\n') + '\n\n';
    }

    const promptText = (conversationContext ? conversationContext : '') + (message || 'Please inspect the attached files.');
    parts.push({ text: promptText });

    // Optional image model attempt
    let generatedImage: string | null = null;
    if (mode === 'image' && message && (message.toLowerCase().includes('generate') || message.toLowerCase().includes('create') || message.toLowerCase().includes('draw'))) {
      try {
        const imgGenRes = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: message,
        });
        const candidateParts = imgGenRes.candidates?.[0]?.content?.parts || [];
        for (const p of candidateParts) {
          if (p.inlineData && p.inlineData.data) {
            generatedImage = `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
            break;
          }
        }
      } catch (err: any) {
        console.warn('Image model generation skipped or not available:', err?.message || err);
      }
    }

    // Call Gemini with multi-tier resilience
    const selectedModel = expert ? 'gemini-3.8-flash' : (model || 'gemini-3.8-flash');
    let response: any = null;
    let usedModel = selectedModel;

    const generateWithModel = async (m: string) => {
      return await ai.models.generateContent({
        model: m,
        contents: { parts },
        config: {
          systemInstruction,
          temperature: expert ? 0.4 : 0.7,
        },
      });
    };

    // Attempt cascade: selectedModel -> gemini-3.1-flash-lite -> gemini-flash-latest
    try {
      response = await generateWithModel(selectedModel);
    } catch (primaryErr: any) {
      console.warn(`Primary model ${selectedModel} failed (${primaryErr.message}). Switching to high-throughput flash-lite...`);
      await new Promise((resolve) => setTimeout(resolve, 800));
      try {
        usedModel = 'gemini-3.1-flash-lite';
        response = await generateWithModel(usedModel);
      } catch (liteErr: any) {
        console.warn(`Flash-lite attempt failed (${liteErr.message}). Retrying with gemini-flash-latest...`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        try {
          usedModel = 'gemini-flash-latest';
          response = await generateWithModel(usedModel);
        } catch (latestErr: any) {
          throw latestErr;
        }
      }
    }

    const replyText = response?.text || 'I could not generate a response for this request.';

    res.json({
      text: replyText,
      image: generatedImage,
      model: usedModel,
      expert,
      mode,
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    let cleanMessage = error?.message || 'An error occurred while communicating with Gemini API.';

    try {
      const parsed = typeof cleanMessage === 'string' && cleanMessage.startsWith('{') ? JSON.parse(cleanMessage) : null;
      if (parsed?.error?.message) {
        cleanMessage = parsed.error.message;
      }
    } catch {
      // Ignore JSON parse error
    }

    const isDemandSpike =
      cleanMessage.includes('503') ||
      cleanMessage.includes('high demand') ||
      cleanMessage.includes('UNAVAILABLE');

    if (isDemandSpike) {
      cleanMessage = 'The AI model is currently experiencing a temporary demand surge. Spikes are usually brief—please wait a few seconds and try again.';
    }

    res.status(isDemandSpike ? 503 : 500).json({
      error: cleanMessage,
      isDemandSpike,
    });
  }
});

// Text-to-speech endpoint using gemini-3.8-flash-lite-tts
apiRouter.post('/speak', async (req, res) => {
  try {
    const { text, voice = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: 'Gemini API is not configured.' });
    }

    const cleanText = text.replace(/```[\s\S]*?```/g, 'Code snippet omitted for audio playback.').slice(0, 400);

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                style: 'Natural, expressive, clear voice',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      return res.status(500).json({ error: 'No audio returned by TTS model.' });
    }

    res.json({
      audio: `data:audio/wav;base64,${base64Audio}`,
    });
  } catch (error: any) {
    console.warn('TTS generation failed:', error?.message);
    res.status(500).json({ error: error?.message || 'TTS failed' });
  }
});
