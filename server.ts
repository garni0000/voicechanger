import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import multer from "multer";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";

dotenv.config();

const upload = multer({ dest: "uploads/" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  // Bot State Management (In-memory for simplicity)
  const userSessions: Record<number, { 
    voiceId?: string; 
    lastAudioId?: string; 
    lastText?: string;
    type?: "tts" | "sts" | "filter";
    filter?: string;
  }> = {};

  // Initialize Telegram Bot
  const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true }) : null;

  if (bot) {
    console.log("Telegram bot initialized.");

    // Voices requested by the user
    const PINNED_VOICES = [
      { id: "21m00Tcm4llvDq8ikWqJ", name: "Rachel (Multilingual)" },
      { id: "pNInz6obpgdqGbcicJws", name: "Adam (Multilingual)" },
      { id: "XB0fDUnXUByWwe3M95Aa", name: "Charlotte (Français)" },
      { id: "kwhMCf63M8O3rCfnQ3oQ", name: "Caroline (Français)" },
      { id: "ONw9qcTvP66onI69vWXI", name: "Daniel (Français)" },
      { id: "YxrwjAKoUKULGd0g8K9Y", name: "Lucie (Français)" },
      { id: "nr2EGJNe96rzn9FRlTId", name: "Yan (Français)" },
      { id: "b0Ev8lcOOXx2o9ZcF46H", name: "Martin (Français)" },
      { id: "Lcf7u9D9ndJHOvhl79A1", name: "Céline (Français)" },
      { id: "t0jbWlSQ5mHqebjPst9x", name: "Bastien (Français)" },
      { id: "m2tcjxz5e0C8EqwM6N5j", name: "Marc" },
      { id: "N2lVS1w4EtoT3dr4eOWO", name: "Callum" },
    ];

    async function getVoices() {
      try {
        if (!ELEVENLABS_API_KEY) return [];
        const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
          headers: { "xi-api-key": ELEVENLABS_API_KEY },
        });
        
        const accountVoices = response.data.voices.map((v: any) => ({ 
          id: v.voice_id, 
          name: v.name 
        }));

        // Only show voices that are actually available in the user's ElevenLabs account
        const accountIds = new Set(accountVoices.map((v: any) => v.id));
        
        const prioritized = PINNED_VOICES.filter(v => accountIds.has(v.id));
        const others = accountVoices.filter((v: any) => !PINNED_VOICES.map(pv => pv.id).includes(v.id));

        return [...prioritized, ...others];
      } catch (error) {
        console.error("Failed to fetch voices:", error);
        return [];
      }
    }

    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, "👋 Welcome to ElevenVox!\n\nI can convert your messages using AI:\n\n🎙️ **Voice message** → Audio AI (Speech-to-Speech)\n*Calque votre émotion et votre tonalité sur la nouvelle voix !*\n\n✍️ **Text message** → Audio (Text-to-Speech)\n\n1️⃣ Envoyez un message.\n2️⃣ Choisissez une voix.\n3️⃣ Recevez votre audio personnalisé ! \n\n💡 Utilisez /deep pour des filtres locaux (Deep Low, Natural, Aigu).");
    });

    bot.onText(/\/deep/, (msg) => {
      const chatId = msg.chat.id;
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔈 Deep Low", callback_data: "filter_deep_low" },
              { text: "🔈 Deep Medium", callback_data: "filter_deep_medium" }
            ],
            [
              { text: "🔉 Deep Deep", callback_data: "filter_deep_deep" },
              { text: "🍃 Natural Deep", callback_data: "filter_natural_deep" }
            ],
            [
              { text: "🔊 Aigu (High)", callback_data: "filter_aigu" },
              { text: "❌ Reset", callback_data: "filter_none" }
            ]
          ],
        },
      };
      bot.sendMessage(chatId, "🎛️ Local FX Menu:\nChoose a filter to apply to your audio (No API key needed for these):", opts);
    });

    bot.on("audio", (msg) => handleAudio(msg));
    bot.on("voice", (msg) => handleAudio(msg));
    bot.on("text", (msg) => {
      if (msg.text?.startsWith("/")) return;
      handleText(msg);
    });

    async function handleText(msg: any) {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (!text) return;

      userSessions[chatId] = { ...userSessions[chatId], lastText: text, type: "tts" };
      await showVoiceMenu(chatId, "✍️ Text received! Choose a voice to speak this text:");
    }

    async function handleAudio(msg: any) {
      const chatId = msg.chat.id;
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      if (!fileId) return;

      userSessions[chatId] = { ...userSessions[chatId], lastAudioId: fileId, type: "sts" };

      // If user has a filter active, offer the choice to use it or ElevenLabs
      if (userSessions[chatId]?.filter) {
        const filterName = userSessions[chatId].filter?.replace("filter_", "").replace("_", " ");
        const opts = {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🚀 Apply Local Filter (${filterName})`, callback_data: "apply_local_filter" }],
              [{ text: "🎨 Use ElevenLabs AI Voice Instead", callback_data: "show_ai_menu" }]
            ]
          }
        };
        bot?.sendMessage(chatId, "🎙️ Audio received! You have a filter active. What do you want to do?", opts);
      } else {
        await showVoiceMenu(chatId, "✨ Audio received! Select a voice for Voice-to-Voice conversion:");
      }
    }

    async function showVoiceMenu(chatId: number, text: string) {
      if (!ELEVENLABS_API_KEY) {
        bot?.sendMessage(chatId, "⚠️ ElevenLabs API Key is missing. Only /deep local filters will work.");
        return;
      }

      bot?.sendMessage(chatId, "🔍 Fetching available voices...");
      const availableVoices = await getVoices();

      if (availableVoices.length === 0) {
        bot?.sendMessage(chatId, "❌ No voices found in your account. Add some to your Voice Lab first.");
        return;
      }

      const opts = {
        reply_markup: {
          inline_keyboard: availableVoices.slice(0, 10).reduce((acc: any[][], v: any, i: number) => {
            if (i % 2 === 0) acc.push([{ text: v.name, callback_data: `voice_${v.id}` }]);
            else acc[acc.length - 1].push({ text: v.name, callback_data: `voice_${v.id}` });
            return acc;
            // Add a back button if they came from filter menu
          }, []),
        },
      };

      bot?.sendMessage(chatId, text, opts);
    }

    bot.on("callback_query", async (callbackQuery) => {
      const chatId = callbackQuery.message?.chat.id;
      const data = callbackQuery.data;

      if (!chatId || !data) return;

      if (data.startsWith("filter_")) {
        const filterType = data;
        userSessions[chatId] = { ...userSessions[chatId], filter: filterType === "filter_none" ? undefined : filterType };
        bot?.answerCallbackQuery(callbackQuery.id, { text: "Filter updated!" });
        bot?.sendMessage(chatId, filterType === "filter_none" ? "✅ Filters cleared." : `✅ Filter set to: ${data.replace("filter_", "").replace("_", " ")}`);
        return;
      }

      if (data === "show_ai_menu") {
        await showVoiceMenu(chatId, "🎨 Select an AI voice:");
        return;
      }

      if (data === "apply_local_filter") {
        const session = userSessions[chatId];
        if (!session.lastAudioId || !session.filter) return;
        
        bot?.answerCallbackQuery(callbackQuery.id, { text: "Processing filter..." });
        await applyLocalFilter(chatId, session.lastAudioId, session.filter);
        return;
      }

      if (data.startsWith("voice_")) {
        const voiceId = data.replace("voice_", "");
        const session = userSessions[chatId];

        if (!session || (!session.lastAudioId && !session.lastText)) {
          bot?.sendMessage(chatId, "❌ No pending message found. Please send text or audio first.");
          return;
        }

        bot?.answerCallbackQuery(callbackQuery.id, { text: "Processing..." });
        bot?.sendMessage(chatId, `⏳ Converting using ElevenLabs ${session.type === "tts" ? "Text-to-Speech" : "Voice-to-Voice"}...`);

        try {
          let audioBuffer: any;

          if (session.type === "sts" && session.lastAudioId) {
            // SPEECH TO SPEECH (STS) - Captures original emotion and tone
            const fileLink = await bot?.getFileLink(session.lastAudioId);
            const response = await axios.get(fileLink, { responseType: "arraybuffer" });
            const tempInputPath = path.join(process.cwd(), `uploads/input_${chatId}_${Date.now()}.ogg`);
            fs.writeFileSync(tempInputPath, response.data);

            const form = new FormData();
            form.append("audio", fs.createReadStream(tempInputPath));
            form.append("model_id", "eleven_multilingual_sts_v2");
            form.append("voice_settings", JSON.stringify({
              stability: 0.45,
              similarity_boost: 0.8,
              style: 0.2, // Boost the original performance style
              use_speaker_boost: true
            }));
            
            const elevenResponse = await axios.post(
              `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`,
              form,
              {
                headers: { ...form.getHeaders(), "xi-api-key": ELEVENLABS_API_KEY },
                responseType: "arraybuffer",
              }
            );
            audioBuffer = elevenResponse.data;
            fs.unlinkSync(tempInputPath);
          } else if (session.type === "tts" && session.lastText) {
            // TEXT TO SPEECH
            const ttsResponse = await axios.post(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
              {
                text: session.lastText,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
              },
              {
                headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
                responseType: "arraybuffer",
              }
            );
            audioBuffer = ttsResponse.data;
          }

          const tempOutputPath = path.join(process.cwd(), `uploads/output_${chatId}_${Date.now()}.mp3`);
          fs.writeFileSync(tempOutputPath, audioBuffer);

          await bot?.sendVoice(chatId, tempOutputPath, { caption: `✅ Done! (${session.type === "tts" ? "Text-to-Voice" : "Voice-to-Voice"})` });
          fs.unlinkSync(tempOutputPath);
        } catch (error: any) {
          const errorData = error.response?.data;
          let errorMsg = "";
          
          try {
            errorMsg = errorData ? JSON.parse(errorData.toString()).detail.message : error.message;
          } catch {
            errorMsg = errorData?.toString() || error.message;
          }

          console.error("ElevenLabs Error:", errorMsg);
          
          if (errorMsg.includes("paid_plan_required")) {
            bot?.sendMessage(chatId, "❌ Upgrade Required: This voice is from the ElevenLabs 'Voice Library' and requires a paid plan for API access.\n\n💡 **Solution:** Try using a 'Pre-made' voice like Rachel or Adam, or upgrade your ElevenLabs subscription to use community voices via the bot.");
          } else if (errorMsg.includes("detected_unusual_activity")) {
            bot?.sendMessage(chatId, "⚠️ Unusual Activity: ElevenLabs Free Tier disabled. Upgrade or try again later.");
          } else {
            bot?.sendMessage(chatId, `❌ Error: ${errorMsg}`);
          }
        }
      }
    });

    async function applyLocalFilter(chatId: number, fileId: string, filterType: string) {
      try {
        const fileLink = await bot?.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: "arraybuffer" });
        const tempInputPath = path.join(process.cwd(), `uploads/local_in_${chatId}_${Date.now()}.ogg`);
        const tempOutputPath = path.join(process.cwd(), `uploads/local_out_${chatId}_${Date.now()}.mp3`);
        fs.writeFileSync(tempInputPath, response.data);

        let filterOptions: string[] = [];
        
        switch (filterType) {
          case "filter_deep_low":
            // Very subtle pitch down + small warmth boost
            filterOptions = ["asetrate=44100*0.93,atempo=1.075,bass=g=3:f=120"];
            break;
          case "filter_deep_medium":
            // Slight pitch down + bass boost
            filterOptions = ["asetrate=44100*0.85,atempo=1.17,bass=g=5:f=100"];
            break;
          case "filter_deep_deep":
            // Strong pitch down + more bass boost
            filterOptions = ["asetrate=44100*0.7,atempo=1.42,bass=g=15:f=80"];
            break;
          case "filter_aigu":
            // Pitch up
            filterOptions = ["asetrate=44100*1.4,atempo=0.71"];
            break;
          case "filter_natural_deep":
            // Complex filter for a more "vocal" deep sound
            // 1. Highpass to remove noise
            // 2. EQ to boost chest frequencies (~120Hz)
            // 3. EQ to cut harshness (~3kHz)
            // 4. Rate shift (pitch down)
            // 5. Tempo correction
            // 6. Subtle vibrato for natural "melody" variation
            // 7. Compand for professional radio-like sound
            filterOptions = [
              "highpass=f=20",
              "equalizer=f=120:width_type=h:width=200:g=8",
              "equalizer=f=3000:width_type=h:width=1000:g=-5",
              "asetrate=44100*0.82,atempo=1.22",
              "vibrato=f=3:d=0.05",
              "compand=0.3|0.3:1|1:-90/-60|-60/-40|-40/-15|-20/-1|0/-1:6:0:-90:0.2"
            ];
            break;
        }

        bot?.sendMessage(chatId, "🔊 Processing with local filters...");

        ffmpeg(tempInputPath)
          .audioFilters(filterOptions)
          .toFormat("mp3")
          .on("end", async () => {
            await bot?.sendVoice(chatId, tempOutputPath, { caption: `✅ Done! (Filter: ${filterType.replace("filter_", "").replace("_", " ")})` });
            fs.unlinkSync(tempInputPath);
            fs.unlinkSync(tempOutputPath);
          })
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            bot?.sendMessage(chatId, "❌ Local filtering failed. Make sure your audio is valid.");
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
          })
          .save(tempOutputPath);
          
      } catch (error) {
        console.error("Local filter error:", error);
        bot?.sendMessage(chatId, "❌ Error processing local filter.");
      }
    }
  }

  // Keep-alive endpoint for free hosting services (Render, etc.)
  app.get("/keep-alive", (req, res) => {
    res.status(200).send("I'm alive!");
  });

  app.get("/api/keep-alive", (req, res) => {
    res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
  });

  // API Routes
  app.get("/api/status", (req, res) => {
    res.json({ 
      status: "online", 
      botEnabled: !!TELEGRAM_BOT_TOKEN,
      elevenLabsEnabled: !!ELEVENLABS_API_KEY 
    });
  });

  // Vite setup for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Ensure uploads directory exists
  if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
