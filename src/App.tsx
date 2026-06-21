import React, { useState, useEffect, ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Bot, 
  Settings, 
  Mic, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  MessageSquare,
  ShieldCheck,
  Cpu
} from "lucide-react";

interface AppStatus {
  status: string;
  botEnabled: boolean;
  elevenLabsEnabled: boolean;
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch("/api/status");
        const data = await res.json();
        setStatus(data);
      } catch (err) {
        console.error("Failed to fetch status:", err);
      } finally {
        setLoading(false);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-5xl flex justify-between items-end mb-12 border-b border-black/10 pb-4">
        <div>
          <div className="hw-text-mono mb-1">Project System v1.0.4</div>
          <h1 className="text-4xl font-bold tracking-tighter">ELEVEN<span className="text-hw-accent">VOX</span></h1>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="hw-text-mono">System Integrity</div>
            <div className="flex items-center justify-end gap-2 font-medium">
              {loading ? "CHECKING..." : status?.status === "online" ? "OPERATIONAL" : "OFFLINE"}
              <div className={`status-glow ${status?.status === "online" ? "text-green-500 bg-current" : "text-hw-accent bg-current"}`} />
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Status & Config */}
        <div className="lg:col-span-1 space-y-6">
          <section className="hw-panel p-6 text-[var(--color-hw-text)] relative overflow-hidden">
            <div className="relative z-10">
              <div className="hw-text-mono mb-4 text-white/40">Hardware Configuration</div>
              
              <div className="space-y-4">
                <StatusItem 
                  label="TELEGRAM BOT" 
                  isActive={!!status?.botEnabled} 
                  icon={<MessageSquare className="w-4 h-4" />}
                />
                <StatusItem 
                  label="ELEVENLABS API" 
                  isActive={!!status?.elevenLabsEnabled} 
                  icon={<Cpu className="w-4 h-4" />}
                />
                <StatusItem 
                  label="DUBBING ENGINE" 
                  isActive={!!status?.elevenLabsEnabled} 
                  icon={<Mic className="w-4 h-4" />}
                />
              </div>

              {!status?.botEnabled || !status?.elevenLabsEnabled ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-8 p-4 bg-hw-accent/10 border border-hw-accent/20 rounded-lg text-hw-accent text-sm flex gap-3"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>Configuration incomplete. Set your API keys in the Secrets panel.</p>
                </motion.div>
              ) : (
                <div className="mt-8 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm flex gap-3">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <p>All systems go. Your bot is listening for incoming signals.</p>
                </div>
              )}
            </div>
            {/* Background Texture */}
            <div className="absolute top-0 right-0 p-2 opacity-5">
              <Bot className="w-32 h-32" />
            </div>
          </section>

          <section className="hw-panel p-6 text-white/90">
            <div className="hw-text-mono mb-4 text-white/40">Gestion des Voix</div>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg text-sm text-white/60">
                <p className="mb-2">Le bot se <span className="text-white">synchronise automatiquement</span> avec votre compte ElevenLabs.</p>
                <p>Seules les voix installées dans votre <span className="text-white">Voice Lab</span> apparaîtront dans le menu Telegram, classées et paginées par pages de 8.</p>
              </div>
              
              <div className="text-xs space-y-2">
                <div className="text-white/40 font-mono">Recommandations FR/Multiling :</div>
                <ul className="list-disc list-inside text-white/60 space-y-1">
                  <li><span className="text-white/80">Lucie / Martin / Céline / Bastien / Sara</span> (Excellent pour le Français)</li>
                  <li><span className="text-white/80">Rachel / Adam / Daniel / Charlotte / Yan</span> (Multilingues & FR)</li>
                  <li><span className="text-hw-accent font-bold">New :</span> <span className="text-white font-mono font-bold">Sea Kitty 🐾</span> (Un ton ultra expressif, mignon et engageant)</li>
                  <li><span className="text-hw-accent font-bold">New :</span> <span className="text-white font-mono font-bold">Seng 🎙️</span> (Une voix de caractère riche et immersive)</li>
                  <li><span className="text-hw-accent font-bold">New :</span> <span className="text-white font-mono font-bold">Story Male 📖</span> (Idéal pour narrer des histoires de manière captivante)</li>
                  <li><span className="text-hw-accent font-bold">New :</span> <span className="text-white font-mono font-bold">Girl Vocal 🎵</span> (Une voix féminine mélodieuse et claire)</li>
                  <li>Ajoutez n'importe quelle voix via la <span className="text-white/80">Voice Library</span> ElevenLabs.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="hw-panel p-6 text-white/90">
            <div className="hw-text-mono mb-4 text-white/40">Ping Automatique (Keep-Alive)</div>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg text-sm text-white/60">
                <p className="mb-2 italic text-hw-accent">Pour éviter la mise en veille sur Render/Free tiers :</p>
                <p className="mb-2 text-[11px]">Configurez un cron-job externe (ex: Cron-job.org) pour interroger cette URL toutes les 5 à 10 minutes :</p>
                <div className="bg-black/50 p-3 rounded font-mono text-[10px] break-all border border-white/10 select-all">
                  {window.location.origin}/keep-alive
                </div>
              </div>
            </div>
          </section>

          <section className="hw-panel p-6 text-white/90">
            <div className="hw-text-mono mb-4 text-white/40">Résolution des Problèmes</div>
            <div className="space-y-3 text-xs leading-relaxed">
              <div className="border-l-2 border-hw-accent pl-3">
                <div className="text-white font-bold mb-1 italic">"Unusual Activity Detected"</div>
                <p className="text-white/50">Fréquent sur l'offre gratuite d'ElevenLabs. Évitez les VPNs ou proxies.</p>
              </div>
              <div className="border-l-2 border-hw-accent pl-3">
                <div className="text-white font-bold mb-1 italic">"Paid Plan Required"</div>
                <p className="text-white/50">ElevenLabs réserve l'API des voix de la bibliothèque communautaire aux abonnements payants. Restez sur des voix pré-définies (Rachel, Adam) sur un compte gratuit.</p>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Instructions */}
        <div className="lg:col-span-2 space-y-6">
          <section className="hw-panel p-8 text-white">
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
              <Settings className="w-6 h-6 text-hw-accent" />
              Directives de Déploiement
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <Step 
                  number="01"
                  title="Créer le Bot Telegram"
                  desc="Discutez avec @BotFather sur Telegram pour instancier un nouveau bot et copier son Token API."
                />
                <Step 
                  number="02"
                  title="Obtenir la clé ElevenLabs"
                  desc="Connectez-vous à ElevenLabs, ouvrez votre profil et copiez votre clé API."
                />
                <Step 
                  number="03"
                  title="Ajouter aux Secrets"
                  desc="Configurez TELEGRAM_BOT_TOKEN et ELEVENLABS_API_KEY dans le panneau des Secrets de l'application."
                />
              </div>

              <div className="space-y-6">
                <div className="bg-white/5 p-6 rounded-xl border border-white/10">
                  <h3 className="font-bold mb-4 flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Comment tester
                  </h3>
                  <ol className="text-sm text-white/60 space-y-3 list-decimal list-inside">
                    <li>Ouvrez votre bot sur Telegram et cliquez sur /start.</li>
                    <li>Envoyez un <span className="text-white">🎙️ Message vocal</span> ou un <span className="text-white">✍️ Texte</span>.</li>
                    <li>Sélectionnez votre voix d'IA dans le menu tactile de 2 colonnes ou naviguez entre les pages.</li>
                    <li>
                      <span className="text-hw-accent font-bold">Clavier Tactile Permanent :</span> Utilisez les boutons de menu au bas de votre écran pour :
                      <ul className="list-disc pl-5 mt-1 space-y-1 text-white/50 text-xs">
                        <li>🎙️ Sélectionner à la volée une voix d'IA ElevenLabs</li>
                        <li>🎭 Configurer l'Émotion souhaitée (Neutre, Colère, Excité, Triste, Chuchotement...)</li>
                        <li>🎛️ Appliquer les Filtres Vocaux FX locaux (Filtres gratuits, instantanés et hors-ligne)</li>
                        <li>🎬 Exporter instantanément en Vidéo Onde 3:1</li>
                      </ul>
                    </li>
                  </ol>
                  <button 
                    onClick={() => window.open(`https://t.me/`, "_blank")}
                    className="w-full mt-6 py-3 bg-white text-black font-bold rounded-lg hover:bg-hw-accent hover:text-white transition-colors flex items-center justify-center gap-2"
                  >
                    Ouvrir le Bot Telegram <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <footer className="hw-panel p-6 flex items-center justify-between">
            <div className="hw-text-mono">Session ID: 49x-Vox-992</div>
            <div className="hw-text-mono flex gap-4">
              <span>Latency: 24ms</span>
              <span>Buffer: 1024KB</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

function StatusItem({ label, isActive, icon }: { label: string; isActive: boolean; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
      <div className="flex items-center gap-3">
        <div className={`${isActive ? 'text-hw-accent' : 'text-white/20'}`}>
          {icon}
        </div>
        <span className="text-xs font-mono tracking-wider">{label}</span>
      </div>
      <div className={`text-[10px] font-bold px-2 py-0.5 rounded ${isActive ? 'bg-green-500/20 text-green-500' : 'bg-hw-accent/20 text-hw-accent'}`}>
        {isActive ? 'ACTIVE' : 'MISSING'}
      </div>
    </div>
  );
}

function Step({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="text-hw-accent font-mono font-bold text-xl opacity-50">{number}</div>
      <div>
        <h4 className="font-bold mb-1">{title}</h4>
        <p className="text-sm text-white/50 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
