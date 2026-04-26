const axios = require("axios");
const { logInfo, logError } = require("../utils/logger");

/**
 * Convert raw PCM (L16) data to proper WAV format by adding RIFF/WAV header
 * @param {Buffer} pcmBuffer - Raw 16-bit PCM audio data
 * @param {number} sampleRate - Sample rate in Hz (e.g. 24000)
 * @param {number} numChannels - Number of channels (1 = mono)
 * @param {number} bitsPerSample - Bits per sample (16)
 * @returns {Buffer} - WAV file buffer
 */
function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const wav = Buffer.alloc(totalSize);
  let offset = 0;

  // RIFF chunk descriptor
  wav.write("RIFF", offset); offset += 4;
  wav.writeUInt32LE(totalSize - 8, offset); offset += 4;
  wav.write("WAVE", offset); offset += 4;

  // fmt sub-chunk
  wav.write("fmt ", offset); offset += 4;
  wav.writeUInt32LE(16, offset); offset += 4;          // sub-chunk size (PCM = 16)
  wav.writeUInt16LE(1, offset); offset += 2;            // audio format (1 = PCM)
  wav.writeUInt16LE(numChannels, offset); offset += 2;
  wav.writeUInt32LE(sampleRate, offset); offset += 4;
  wav.writeUInt32LE(byteRate, offset); offset += 4;
  wav.writeUInt16LE(blockAlign, offset); offset += 2;
  wav.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  wav.write("data", offset); offset += 4;
  wav.writeUInt32LE(dataSize, offset); offset += 4;
  pcmBuffer.copy(wav, offset);

  return wav;
}

/**
 * Parse sample rate from mimeType like "audio/L16;codec=pcm;rate=24000"
 */
function parseSampleRate(mimeType) {
  const match = mimeType.match(/rate=(\d+)/);
  return match ? parseInt(match[1], 10) : 24000;
}

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
    const rawBuffer = Buffer.from(audioBase64, "base64");

    // If Gemini returned raw PCM (audio/L16), wrap it in a proper WAV file
    if (mimeType.includes("L16") || mimeType.includes("pcm")) {
      const sampleRate = parseSampleRate(mimeType);
      logInfo(`Converting raw PCM to WAV (sampleRate: ${sampleRate}Hz)`);
      const wavBuffer = pcmToWav(rawBuffer, sampleRate);
      logInfo(`WAV buffer size: ${wavBuffer.length} bytes`);
      return wavBuffer;
    }

    return rawBuffer;
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
