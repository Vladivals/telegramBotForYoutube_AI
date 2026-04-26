const axios = require("axios");
const { logInfo, logError } = require("../utils/logger");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini 2.5 Pro TTS model
const TTS_MODEL = "gemini-2.5-pro-preview-tts";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;

// System prompt for YouTube cooking voiceover for American audience
const SYSTEM_INSTRUCTION = `You are a professional voiceover artist for YouTube cooking videos targeting an American audience. 
Your narration style is warm, enthusiastic, and friendly — like a knowledgeable home chef sharing their passion for food. 
Speak naturally with American English pronunciation, good pacing, and engaging delivery. 
Make the recipes sound delicious and approachable. 
Add natural pauses and emphasis where appropriate for video narration.`;

/**
 * Generate voiceover audio using Gemini 2.5 Pro TTS
 * @param {string} text - The script text to convert to speech
 * @returns {Promise<Buffer>} - Audio buffer in WAV format
 */
async function generateVoiceover(text) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables");
  }

  logInfo(`Calling Gemini TTS API, text length: ${text.length} chars`);

  // Build the TTS prompt with system instructions embedded
  const ttsPrompt = `${SYSTEM_INSTRUCTION}\n\nPlease read the following cooking script naturally for a YouTube video:\n\n${text}`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: ttsPrompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: process.env.GEMINI_TTS_VOICE || "Kore",
          },
        },
      },
    },
  };

  try {
    const response = await axios.post(`${API_URL}?key=${GEMINI_API_KEY}`, requestBody, {
      headers: { "Content-Type": "application/json" },
      timeout: 120000, // 2 minute timeout for TTS generation
    });

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      logError(`Unexpected Gemini TTS response: ${JSON.stringify(response.data).slice(0, 500)}`);
      throw new Error("Gemini TTS returned no audio data");
    }

    const inlineData = response.data.candidates[0].content.parts[0].inlineData;
    const audioBase64 = inlineData.data;
    const mimeType = inlineData.mimeType || "audio/wav";

    logInfo(`Gemini TTS success, mimeType: ${mimeType}, base64 length: ${audioBase64.length}`);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(audioBase64, "base64");
    return audioBuffer;
  } catch (error) {
    if (error.response) {
      const errData = JSON.stringify(error.response.data).slice(0, 500);
      logError(`Gemini TTS API error ${error.response.status}: ${errData}`);
      throw new Error(`Gemini TTS API error (${error.response.status}): ${error.response.data?.error?.message || errData}`);
    }
    logError(`Gemini TTS request failed: ${error.message}`);
    throw error;
  }
}

module.exports = { generateVoiceover };
