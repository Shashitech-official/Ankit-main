import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '30mb' }));

// Helper to get Gemini Client with recommended User-Agent header
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
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
app.get('/api/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
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
app.post('/api/chat', async (req, res) => {
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
        error: 'Gemini API key is not configured. Please ensure GEMINI_API_KEY is configured in your AI Studio project secrets or .env file.',
      });
    }

    // Determine system instructions based on workspace mode
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
        
        // Native inlineData support for images, pdf, audio
        if (
          mimeType.startsWith('image/') ||
          mimeType === 'application/pdf' ||
          mimeType.startsWith('audio/')
        ) {
          parts.push({
            inlineData: {
              mimeType,
              data: file.data, // base64 string
            },
          });
        } else {
          // Plain text or code file
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

    // Include recent history context if present
    let conversationContext = '';
    if (Array.isArray(history) && history.length > 0) {
      const recent = history.slice(-6);
      conversationContext = 'Previous context:\n' + recent.map((item: any) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`).join('\n') + '\n\n';
    }

    const promptText = (conversationContext ? conversationContext : '') + (message || 'Please inspect the attached files.');
    parts.push({ text: promptText });

    // Check if image generation model is requested in image mode
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

    // Call Gemini with retry resilience
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

    try {
      response = await generateWithModel(selectedModel);
    } catch (primaryErr: any) {
      console.warn(`Primary model ${selectedModel} failed (${primaryErr.message}). Retrying...`);
      // Brief delay before retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        response = await generateWithModel(selectedModel);
      } catch (retryErr: any) {
        // If 503 or unavailable, attempt alternative model
        console.warn('Retrying with alternative flash model due to demand spike...');
        usedModel = 'gemini-flash-latest';
        response = await generateWithModel(usedModel);
      }
    }

    const replyText = response?.text || 'I could not generate a response for this request.';

    res.json({
      text: replyText,
      image: generatedImage,
      model: selectedModel,
      expert,
      mode,
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).json({
      error: error.message || 'An error occurred while communicating with Gemini API.',
    });
  }
});

// Text-to-speech endpoint using gemini-3.8-flash-lite-tts
app.post('/api/speak', async (req, res) => {
  try {
    const { text, voice = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required for TTS' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({ error: 'Gemini API is not configured.' });
    }

    // Limit text to first 400 characters to keep audio generation fast and responsive
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

// Setup Vite middleware in dev or static files in production
async function start() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Abs AI Assistant server running at http://0.0.0.0:${PORT}`);
  });
}

start();
