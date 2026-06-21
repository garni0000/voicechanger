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
    emotion?: string;
    lastLocalPath?: string;
    format?: "voice" | "mp3";
  }> = {};

  // Safely persist the latest audio path per user and delete any previous file to avoid storage waste
  function saveUserAudioPath(chatId: number, newPath: string) {
    const previous = userSessions[chatId]?.lastLocalPath;
    if (previous && fs.existsSync(previous)) {
      try {
        fs.unlinkSync(previous);
      } catch (e) {
        console.warn("Could not delete old audio file:", e);
      }
    }
    userSessions[chatId] = { ...userSessions[chatId], lastLocalPath: newPath };
  }

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
      { id: "5opxviIE64D8KxYYJKpx", name: "Sara (Français)" },
      { id: "E2Ezcd6NoRiOvrIwom5L", name: "Sea Kitty 🐾" },
      { id: "4oWJ6V7lazUIAOhvQwOk", name: "Seng 🎙️" },
      { id: "2IUqjhqJ7AH1z0jFh6B0", name: "Story Male 📖" },
      { id: "iHDcsclpAgVZFNeNdcib", name: "Girl Vocal 🎵" },
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

    // Main persistent layout menu for Telegram
    const getKeyboard = (chatId: number) => {
      const session = userSessions[chatId];
      const isMp3 = session?.format === "mp3";
      return {
        keyboard: [
          [
            { text: "🎙️ Sélectionner une Voix" },
            { text: "🎭 Configurer l'Émotion" }
          ],
          [
            { text: "🎛️ Filtres Vocaux (Deep FX)" },
            { text: "🎬 Créer Vidéo Onde 3:1" }
          ],
          [
            { text: isMp3 ? "⚙️ Format actuel : 🎵 MP3 (Audio)" : "⚙️ Format actuel : 🎙️ Note Vocale" }
          ]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };
    };

    function toggleFormat(chatId: number) {
      const session = userSessions[chatId] || {};
      const currentFormat = session.format || "voice";
      const newFormat = currentFormat === "mp3" ? "voice" : "mp3";
      userSessions[chatId] = { ...session, format: newFormat };
      
      const formatLabel = newFormat === "mp3" ? "🎵 MP3 (Audio)" : "🎙️ Note Vocale";
      bot?.sendMessage(
        chatId, 
        `⚙️ **Format de sortie mis à jour !**\n\nLe bot générera désormais vos créations vocales au format : **${formatLabel}**.\n\n* **Note Vocale** : Idéal pour écouter instantanément via le lecteur intégré de Telegram.\n* **MP3 (Audio)** : Fichier audio de haute qualité téléchargeable, parfait pour exporter ou partager sur d'autres applications.`,
        { reply_markup: getKeyboard(chatId), parse_mode: "Markdown" }
      );
    }

    function sendDeepMenu(chatId: number) {
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
              { text: "❌ Désactiver Filtre", callback_data: "filter_none" }
            ]
          ],
        },
      };
      bot?.sendMessage(
        chatId, 
        "🎛️ **Menu Effets Vocaux Locaux (Deep FX)** :\n\nChoisissez un filtre à appliquer à votre audio (s'exécute localement sans consommer de crédit API) :", 
        { reply_markup: opts.reply_markup, parse_mode: "Markdown" }
      );
    }

    function sendEmotionMenu(chatId: number) {
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🎭 Neutre (Default)", callback_data: "emotion_none" },
              { text: "🤬 Colère (Angry)", callback_data: "emotion_angry" }
            ],
            [
              { text: "😢 Triste (Sad)", callback_data: "emotion_sad" },
              { text: "😃 Joyeux (Excited)", callback_data: "emotion_excited" }
            ],
            [
              { text: "🤫 Chuchoter (Whisper)", callback_data: "emotion_whisper" },
              { text: "😱 Effrayé (Scared)", callback_data: "emotion_scared" }
            ],
            [
              { text: "📢 Dramatique (Dramatic)", callback_data: "emotion_dramatic" }
            ]
          ],
        },
      };
      bot?.sendMessage(
        chatId, 
        "🎭 **Sélection d'Émotions (ElevenLabs)** :\n\nChoisissez un ton ou style émotionnel pour vos futures générations (TTS & STS) :\n\n*(L'émotion modifie les paramètres de stabilité, de style et de clarté pour un rendu optimal !)*", 
        { reply_markup: opts.reply_markup, parse_mode: "Markdown" }
      );
    }

    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(
        chatId, 
        "👋 **Bienvenue sur ElevenVox !**\n\nJe peux métamorphoser vos messages en utilisant des voix d'IA de pointe :\n\n🎙️ **Message vocal (Vocal-to-Vocal)** :\n*Conserve parfaitement l'intensité et le rythme d'origine !*\n\n✍️ **Message texte (Text-to-Speech)** :\n*Génère un rendu vocal fluide et ultra-naturel.*\n\n💥 Utilisez le **menu permanent** en bas de votre écran pour naviguer facilement et configurer vos effets !", 
        { reply_markup: getKeyboard(chatId), parse_mode: "Markdown" }
      );
    });

    bot.onText(/\/deep/, (msg) => {
      sendDeepMenu(msg.chat.id);
    });

    bot.onText(/\/emotion/, (msg) => {
      sendEmotionMenu(msg.chat.id);
    });

    bot.onText(/\/format/, (msg) => {
      toggleFormat(msg.chat.id);
    });

    bot.on("audio", (msg) => handleAudio(msg));
    bot.on("voice", (msg) => handleAudio(msg));
    bot.on("text", (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (!text) return;

      if (text.startsWith("/")) return;

      // Map persistent button commands to their clean triggers
      if (text === "🎙️ Sélectionner une Voix") {
        const session = userSessions[chatId];
        if (!session || (!session.lastAudioId && !session.lastText)) {
          bot.sendMessage(chatId, "⚠️ **Aucun contenu récent !** Veuillez envoyer d'abord un message vocal (🎙️) ou un texte (✍️), puis cliquez à nouveau sur ce bouton pour lui prêter une voix d'IA.");
          return;
        }
        showVoiceMenu(chatId, session.type === "tts" ? "✍️ Texte enregistré ! Sélectionnez une voix :" : "✨ Audio enregistré ! Sélectionnez une voix :");
        return;
      }

      if (text === "🎭 Configurer l'Émotion") {
        sendEmotionMenu(chatId);
        return;
      }

      if (text === "🎛️ Filtres Vocaux (Deep FX)") {
        sendDeepMenu(chatId);
        return;
      }

      if (text.startsWith("⚙️ Format actuel :")) {
        toggleFormat(chatId);
        return;
      }

      if (text === "🎬 Créer Vidéo Onde 3:1" || text === "🎬 Créer Vidéo") {
        const session = userSessions[chatId];
        if (!session || !session.lastLocalPath) {
          bot.sendMessage(chatId, "❌ **Données introuvables :** Aucun audio récent trouvé. Envoyez d'abord un message vocal, un texte, ou répondez à un message audio existant avec /tovideo !");
          return;
        }
        convertToWaveformVideo(chatId, session.lastLocalPath);
        return;
      }

      handleText(msg);
    });

    async function handleText(msg: any) {
      const chatId = msg.chat.id;
      const text = msg.text;
      if (!text) return;

      userSessions[chatId] = { ...userSessions[chatId], lastText: text, type: "tts" };
      await showVoiceMenu(chatId, "✍️ **Texte reçu !** Choisissez maintenant une voix d'IA à lui attribuer :");
    }

    async function handleAudio(msg: any) {
      const chatId = msg.chat.id;
      const fileId = msg.voice?.file_id || msg.audio?.file_id;
      if (!fileId) return;

      userSessions[chatId] = { ...userSessions[chatId], lastAudioId: fileId, type: "sts" };

      // Pre-download audio so the user can easily run /tovideo directly or convert later
      try {
        const fileLink = await bot?.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: "arraybuffer" });
        const localIncoming = path.join(process.cwd(), `uploads/incoming_${chatId}_${Date.now()}.ogg`);
        fs.writeFileSync(localIncoming, response.data);
        saveUserAudioPath(chatId, localIncoming);
      } catch (err) {
        console.error("Failed to pre-download incoming audio:", err);
      }

      // If user has a filter active, offer the choice to use it or ElevenLabs
      if (userSessions[chatId]?.filter) {
        const filterName = userSessions[chatId].filter?.replace("filter_", "").replace("_", " ");
        const opts = {
          reply_markup: {
            inline_keyboard: [
              [{ text: `🚀 Appliquer le filtre local (${filterName.toUpperCase()})`, callback_data: "apply_local_filter" }],
              [{ text: "🎨 Ignorer et utiliser une voix IA ElevenLabs", callback_data: "show_ai_menu" }]
            ]
          }
        };
        bot?.sendMessage(chatId, `🎙️ **Audio enregistré !** Vous avez un style filtre local activé (${filterName.toUpperCase()}). Quelle action souhaitez-vous exécuter ?`, { reply_markup: opts.reply_markup, parse_mode: "Markdown" });
      } else {
        await showVoiceMenu(chatId, "✨ **Audio enregistré !** Sélectionnez la voix d'IA ElevenLabs de votre choix pour transmuter ce message :");
      }
    }

    async function showVoiceMenu(chatId: number, text: string, page = 0, messageId?: number) {
      if (!ELEVENLABS_API_KEY) {
        bot?.sendMessage(chatId, "⚠️ Clé API ElevenLabs manquante. Seuls les filtres locaux /deep sont disponibles.");
        return;
      }

      const availableVoices = await getVoices();

      if (availableVoices.length === 0) {
        bot?.sendMessage(chatId, "❌ Aucune voix trouvée sur votre compte ElevenLabs. Ajoutez-en via votre panel Voice Lab.");
        return;
      }

      // Paginate at 8 voices per page
      const PAGE_SIZE = 8;
      const totalPages = Math.ceil(availableVoices.length / PAGE_SIZE);
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      
      const start = currentPage * PAGE_SIZE;
      const paginatedVoices = availableVoices.slice(start, start + PAGE_SIZE);

      const rows: any[][] = [];
      for (let i = 0; i < paginatedVoices.length; i += 2) {
        const row = [
          { text: paginatedVoices[i].name, callback_data: `voice_${paginatedVoices[i].id}` }
        ];
        if (i + 1 < paginatedVoices.length) {
          row.push({ text: paginatedVoices[i + 1].name, callback_data: `voice_${paginatedVoices[i + 1].id}` });
        }
        rows.push(row);
      }

      // Add neat pagination navigation row
      const navButtons: any[] = [];
      if (currentPage > 0) {
        navButtons.push({ text: "⬅️ Précédent", callback_data: `voicepage_${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        navButtons.push({ text: "Suivant ➡️", callback_data: `voicepage_${currentPage + 1}` });
      }
      if (navButtons.length > 0) {
        rows.push(navButtons);
      }

      const formattedText = `${text}\n\n📖 _Page ${currentPage + 1} sur ${totalPages}_`;

      const opts = {
        reply_markup: {
          inline_keyboard: rows
        },
        parse_mode: "Markdown" as const
      };

      if (messageId) {
        try {
          await bot?.editMessageText(formattedText, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: opts.reply_markup,
            parse_mode: "Markdown"
          });
        } catch (err) {
          // If message text/markup is identical, ignore edit warning
          console.warn("Edit voice menu warning:", err);
        }
      } else {
        await bot?.sendMessage(chatId, formattedText, opts);
      }
    }

    bot.on("callback_query", async (callbackQuery) => {
      const chatId = callbackQuery.message?.chat.id;
      const data = callbackQuery.data;

      if (!chatId || !data) return;

      if (data.startsWith("voicepage_")) {
        const pageNum = parseInt(data.replace("voicepage_", ""), 10);
        bot?.answerCallbackQuery(callbackQuery.id);
        const text = userSessions[chatId]?.type === "tts" 
          ? "✍️ **Mode Texte** : Choisissez une voix d'IA pour synthétiser le texte :" 
          : "✨ **Mode Audio** : Sélectionnez une voix d'IA pour la conversion :";
        await showVoiceMenu(chatId, text, pageNum, callbackQuery.message?.message_id);
        return;
      }

      if (data.startsWith("filter_")) {
        const filterType = data;
        userSessions[chatId] = { ...userSessions[chatId], filter: filterType === "filter_none" ? undefined : filterType };
        bot?.answerCallbackQuery(callbackQuery.id, { text: "Filter updated!" });
        bot?.sendMessage(chatId, filterType === "filter_none" ? "✅ Filters cleared." : `✅ Filter set to: ${data.replace("filter_", "").replace("_", " ")}`);
        return;
      }

      if (data.startsWith("emotion_")) {
        const emotionType = data.replace("emotion_", "");
        userSessions[chatId] = { ...userSessions[chatId], emotion: emotionType === "none" ? undefined : emotionType };
        bot?.answerCallbackQuery(callbackQuery.id, { text: `Emotion: ${emotionType}` });
        bot?.sendMessage(chatId, emotionType === "none" ? "✅ Émotion réinitialisée à Neutre." : `✅ Émotion configurée sur : ${emotionType.toUpperCase()}`);
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

      if (data === "convert_to_video") {
        const session = userSessions[chatId];
        if (!session || !session.lastLocalPath) {
          bot?.answerCallbackQuery(callbackQuery.id, { text: "Fichier inexistant ou expire" });
          bot?.sendMessage(chatId, "❌ Aucun audio récent trouvé à convertir.");
          return;
        }
        bot?.answerCallbackQuery(callbackQuery.id, { text: "Création vidéo..." });
        await convertToWaveformVideo(chatId, session.lastLocalPath);
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

            let stability = 0.45;
            let similarity_boost = 0.8;
            let style = 0.2;
            let use_speaker_boost = true;

            if (voiceId === "E2Ezcd6NoRiOvrIwom5L") {
              stability = 0.35;
              similarity_boost = 0.90;
              style = 0.40;
            }

            if (session.emotion) {
              const emotionMap: Record<string, { stability: number, similarity: number, style: number }> = {
                angry: { stability: 0.35, similarity: 0.8, style: 0.5 },
                sad: { stability: 0.3, similarity: 0.75, style: 0.2 },
                excited: { stability: 0.45, similarity: 0.85, style: 0.4 },
                whisper: { stability: 0.35, similarity: 0.85, style: 0.25 },
                scared: { stability: 0.3, similarity: 0.75, style: 0.3 },
                dramatic: { stability: 0.4, similarity: 0.8, style: 0.35 }
              };
              const emoConfig = emotionMap[session.emotion];
              if (emoConfig) {
                stability = emoConfig.stability;
                similarity_boost = emoConfig.similarity;
                style = emoConfig.style;
              }
            }

            const form = new FormData();
            form.append("audio", fs.createReadStream(tempInputPath));
            form.append("model_id", "eleven_multilingual_sts_v2");
            form.append("voice_settings", JSON.stringify({
              stability,
              similarity_boost,
              style,
              use_speaker_boost
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
            let textToSpeak = session.lastText;
            let stability = 0.5;
            let similarity_boost = 0.75;
            let style = 0.0;

            if (voiceId === "E2Ezcd6NoRiOvrIwom5L") {
              stability = 0.35;
              similarity_boost = 0.90;
              style = 0.45;
            }

            if (session.emotion) {
              const emotionMap: Record<string, { stability: number, similarity: number, style: number }> = {
                angry: { stability: 0.35, similarity: 0.8, style: 0.45 },
                sad: { stability: 0.3, similarity: 0.75, style: 0.15 },
                excited: { stability: 0.45, similarity: 0.85, style: 0.35 },
                whisper: { stability: 0.35, similarity: 0.85, style: 0.20 },
                scared: { stability: 0.3, similarity: 0.75, style: 0.25 },
                dramatic: { stability: 0.4, similarity: 0.8, style: 0.30 }
              };
              const emoConfig = emotionMap[session.emotion];
              if (emoConfig) {
                stability = emoConfig.stability;
                similarity_boost = emoConfig.similarity;
                style = emoConfig.style;
              }
            }

            const ttsResponse = await axios.post(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
              {
                text: textToSpeak,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability, similarity_boost, style }
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

          const isMp3Format = session.format === "mp3";
          const captionText = `✅ Done! (${session.type === "tts" ? "Text-to-Voice" : "Voice-to-Voice"})`;
          const replyMarkup = {
            inline_keyboard: [
              [{ text: "🎥 Convertir en Vidéo (Onde 3:1)", callback_data: "convert_to_video" }]
            ]
          };

          if (isMp3Format) {
            await bot?.sendAudio(chatId, tempOutputPath, { 
              caption: captionText,
              reply_markup: replyMarkup
            });
          } else {
            await bot?.sendVoice(chatId, tempOutputPath, { 
              caption: captionText,
              reply_markup: replyMarkup
            });
          }
          saveUserAudioPath(chatId, tempOutputPath);
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
            const isMp3Format = userSessions[chatId]?.format === "mp3";
            const captionText = `✅ Done! (Filter: ${filterType.replace("filter_", "").replace("_", " ")})`;
            const replyMarkup = {
              inline_keyboard: [
                [{ text: "🎥 Convertir en Vidéo (Onde 3:1)", callback_data: "convert_to_video" }]
              ]
            };

            if (isMp3Format) {
              await bot?.sendAudio(chatId, tempOutputPath, { 
                caption: captionText,
                reply_markup: replyMarkup
              });
            } else {
              await bot?.sendVoice(chatId, tempOutputPath, { 
                caption: captionText,
                reply_markup: replyMarkup
              });
            }
            fs.unlinkSync(tempInputPath);
            saveUserAudioPath(chatId, tempOutputPath);
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

    bot.onText(/\/tovideo/, async (msg) => {
      const chatId = msg.chat.id;

      // Detect if user is replying to a voice/audio message to convert it
      const replyToMsg = msg.reply_to_message;
      if (replyToMsg) {
        const fileId = replyToMsg.voice?.file_id || replyToMsg.audio?.file_id;
        if (fileId) {
          bot.sendMessage(chatId, "📥 Téléchargement de l'audio répondu...");
          try {
            const fileLink = await bot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: "arraybuffer" });
            const localIncoming = path.join(process.cwd(), `uploads/incoming_${chatId}_${Date.now()}.ogg`);
            fs.writeFileSync(localIncoming, response.data);
            saveUserAudioPath(chatId, localIncoming);
          } catch (err: any) {
            bot.sendMessage(chatId, `❌ Échec du téléchargement de l'audio répondu : ${err.message}`);
            return;
          }
        }
      }

      const session = userSessions[chatId];
      if (!session || !session.lastLocalPath) {
        bot.sendMessage(chatId, "❌ Aucun audio récent trouvé. Envoyez d'abord un message vocal, un texte, ou répondez à un message audio avec /tovideo !");
        return;
      }

      await convertToWaveformVideo(chatId, session.lastLocalPath);
    });

    async function convertToWaveformVideo(chatId: number, inputPath: string) {
      if (!fs.existsSync(inputPath)) {
        bot?.sendMessage(chatId, "⚠️ Le fichier audio source n'existe plus ou est expiré. Veuillez ré-envoyer un message.");
        return;
      }

      bot?.sendMessage(chatId, "🎬 **Production de votre vidéo avec onde audio dynamique (3:1)...** 🎨");

      const tempVideoPath = path.join(process.cwd(), `uploads/wave_${chatId}_${Date.now()}.mp4`);

      ffmpeg(inputPath)
        .inputOptions(["-y"])
        .complexFilter([
          // High-contrast, modern layout in 3:1 aspect ratio with modern sky blue theme
          "showwaves=s=1200x400:mode=line:rate=30:colors=0x22D3EE:scale=sqrt,format=yuv420p[v]"
        ])
        .outputOptions([
          "-map [v]",
          "-map 0:a",
          "-c:v libx264",
          "-c:a aac",
          "-pix_fmt yuv420p",
          "-shortest",
          "-b:a 192k"
        ])
        .on("end", async () => {
          try {
            await bot?.sendVideo(chatId, tempVideoPath, {
              caption: "🎥 **Votre vidéo est prête !** (Onde audio 3:1)"
            });
          } catch (err: any) {
            console.error("Failed to send video message:", err);
            bot?.sendMessage(chatId, `❌ Erreur de transmission de la vidéo : ${err.message}`);
          } finally {
            if (fs.existsSync(tempVideoPath)) {
              try { fs.unlinkSync(tempVideoPath); } catch {}
            }
          }
        })
        .on("error", (err) => {
          console.error("FFmpeg video generation error:", err);
          bot?.sendMessage(chatId, `❌ Impossible de générer la vidéo : ${err.message}`);
          if (fs.existsSync(tempVideoPath)) {
            try { fs.unlinkSync(tempVideoPath); } catch {}
          }
        })
        .save(tempVideoPath);
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
