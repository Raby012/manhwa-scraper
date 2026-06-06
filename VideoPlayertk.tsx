"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamSource, Language } from "@/lib/embed-sources";
import {
  getEmbedSources,
  getAnilistEmbedSources,
  getMalEmbedSources,
  getIndianDubSources,
} from "@/lib/embed-sources";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";

const LANGUAGES: { key: Language; label: string; flag: string }[] = [
  { key: "sub",    label: "SUB",    flag: "🇯🇵" },
  { key: "dub",    label: "DUB",    flag: "🇬🇧" },
  { key: "hindi",  label: "हिंदी",  flag: "🇮🇳" },
  { key: "tamil",  label: "தமிழ்", flag: "🇮🇳" },
  { key: "telugu", label: "తెలుగు", flag: "🇮🇳" },
];

interface VideoPlayerProps {
  animeTitle: string;
  anilistId: number;
  malId?: number | null;
  episode: number;
  season?: number;
  seasonYear?: number | null;
  imdbId?: string | null;
  tmdbId?: number | null;
  isMovie?: boolean;
  onEpisodeEnd?: () => void;
  onProgress?: (episode: number) => void;
}

export function VideoPlayer({
  animeTitle,
  anilistId,
  malId,
  episode,
  season = 1,
  seasonYear,
  imdbId,
  tmdbId,
  isMovie = false,
  onEpisodeEnd,
  onProgress,
}: VideoPlayerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const hlsRef    = useRef<unknown>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [language,      setLanguage]      = useState<Language>("sub");
  const [allSources,    setAllSources]    = useState<StreamSource[]>([]);
  const [sourceIndex,   setSourceIndex]   = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);
  const [providerLabel, setProviderLabel] = useState("");

  const sources = allSources.filter((s) => (s.lang ?? "sub") === language);

  const addUnique = useCallback((newSrcs: StreamSource[], prepend = false) => {
    setAllSources((prev) => {
      const seen = new Set(prev.map((s) => s.url));
      const fresh = newSrcs.filter((s) => !seen.has(s.url));
      if (!fresh.length) return prev;
      return prepend ? [...fresh, ...prev] : [...prev, ...fresh];
    });
  }, []);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(false);
    setAllSources([]);
    setSourceIndex(0);

    // ── Phase 1: instant fallback sources ────────────────────────────────
    // These show immediately. They work for mapped anime.
    // The Anikoto resolver (Phase 2) will prepend better sources when ready.
    const instant: StreamSource[] = [
      ...getAnilistEmbedSources(anilistId, episode, isMovie, malId),
      ...getIndianDubSources(anilistId, episode, isMovie, malId),
      ...(malId ? getMalEmbedSources(malId, episode, isMovie) : []),
      ...(imdbId || tmdbId
        ? getEmbedSources(imdbId ?? null, tmdbId ?? null, season, episode, isMovie)
        : []),
    ];
    setAllSources(instant);
    setLoading(false);

    // ── Phase 2: Anikoto resolver — the REAL fix ──────────────────────────
    // /api/anikoto/[anilistId] searches Anikoto by title, fetches the full
    // episode list with episode_embed_id, returns /stream/s-2/ URLs.
    // These work for the FULL library, not just mapped anime.
    // Cached for 1 hour on Vercel's CDN — super fast after first load.
    try {
      const anikotoRes = await fetch(`/api/anikoto/${anilistId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (anikotoRes.ok) {
        const data = await anikotoRes.json() as {
          found: boolean;
          episodes: { number: number; sub: string | null; dub: string | null }[];
        };
        if (data.found && data.episodes?.length) {
          const ep = data.episodes.find((e) => e.number === episode);
          if (ep) {
            const anikotoSources: StreamSource[] = [];
            if (ep.sub) anikotoSources.push({ type: "embed", url: ep.sub, provider: "Anikoto Sub ✓", lang: "sub" });
            if (ep.dub) anikotoSources.push({ type: "embed", url: ep.dub, provider: "Anikoto Dub ✓", lang: "dub" });
            // Prepend — these are the best sources, put them first
            if (anikotoSources.length) addUnique(anikotoSources, true);
          }
        }
      }
    } catch (e) {
      console.error("Anikoto resolver failed:", e);
    }

    // ── Phase 3: async m3u8 + extra embed sources (background) ───────────
    const base    = `/api/stream?title=${encodeURIComponent(animeTitle)}&episode=${episode}`;
    const seasonQ = `&season=${season}${seasonYear ? `&year=${seasonYear}` : ""}`;

    const asyncFetches: Promise<StreamSource[]>[] = [
      // HiAnime m3u8 — real video stream
      fetch(`${base}&provider=hianime`)
        .then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => []),
      // Anikoto m3u8 — real video stream
      fetch(`${base}&provider=anikoto`)
        .then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => []),
      // TMDB extra embeds
      fetch(`${base}${seasonQ}&provider=tmdb`)
        .then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => []),
      // GogoAnime m3u8
      fetch(`${base}&provider=gogoanime`)
        .then((r) => r.json())
        .then((d) => ((d.sources ?? []) as StreamSource[]).map((s) => ({ ...s, lang: "sub" as const })))
        .catch(() => []),
      // AnimePahe m3u8
      fetch(`${base}&provider=animepahe`)
        .then((r) => r.json())
        .then((d) => ((d.sources ?? []) as StreamSource[]).map((s) => ({ ...s, lang: "sub" as const })))
        .catch(() => []),
    ];

    // Add each as it resolves — m3u8 go to front
    asyncFetches.forEach((p) =>
      p.then((newSrcs) => {
        if (!newSrcs.length) return;
        const m3u8s  = newSrcs.filter((s) => s.type === "m3u8");
        const embeds = newSrcs.filter((s) => s.type === "embed");
        if (m3u8s.length)  addUnique(m3u8s, true);   // prepend m3u8
        if (embeds.length) addUnique(embeds, false);  // append embeds
      })
    );
  }, [anilistId, animeTitle, malId, episode, season, seasonYear, imdbId, tmdbId, isMovie, addUnique]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // Reset when language tab changes
  useEffect(() => {
    setSourceIndex(0);
    setError(false);
  }, [language]);

  // Load source when index changes
  useEffect(() => {
    if (loading || !sources.length) return;
    const src = sources[sourceIndex];
    if (!src) { setError(true); return; }
    setProviderLabel(src.provider);
    if (src.type === "m3u8") loadHLS(src.url, src.subtitles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, sourceIndex, loading]);

  // postMessage — progress/complete tracking only (no auto-skip)
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      try {
        const d = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (d?.event === "complete") onEpisodeEnd?.();
        if ((d?.event === "time" && (d.percent ?? 0) > 0.05) ||
            (d?.type === "watching-log" && (d.currentTime ?? 0) > 30)) {
          onProgress?.(episode);
        }
      } catch {}
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [episode, onEpisodeEnd, onProgress]);

  async function loadHLS(url: string, subtitles?: { url: string; lang: string }[]) {
    if (typeof window === "undefined") return;
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { (hlsRef.current as { destroy: () => void }).destroy(); hlsRef.current = null; }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else {
      const Hls = (await import("hls.js")).default;
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: false });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean }) => {
          if (data.fatal) console.error("HLS fatal error");
        });
      }
    }
  }

  const currentSource = sources[sourceIndex];
  const isEmbed = currentSource?.type === "embed";

  const langCounts = LANGUAGES.reduce((acc, l) => {
    acc[l.key] = allSources.filter((s) => (s.lang ?? "sub") === l.key).length;
    return acc;
  }, {} as Record<Language, number>);

  return (
    <div className="w-full">
      {/* Language tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-1">
        {LANGUAGES.map((l) => {
          const count = langCounts[l.key] || 0;
          const isIndian = ["hindi", "tamil", "telugu"].includes(l.key);
          // Hide Indian tabs when no sources and not loading
          if (isIndian && count === 0 && !loading) return null;
          return (
            <button
              key={l.key}
              onClick={() => setLanguage(l.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 border ${
                language === l.key
                  ? "bg-brand text-white border-brand shadow-lg shadow-brand/30"
                  : count > 0
                  ? "bg-surface-2 text-gray-300 border-white/10 hover:border-brand/50 hover:text-white"
                  : "bg-surface-1 text-gray-600 border-white/5"
              }`}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
              {count > 0 && (
                <span className={`text-xs rounded-full px-1 ${language === l.key ? "bg-white/20 text-white" : "bg-white/10 text-gray-400"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Player */}
      <div className="w-full aspect-video bg-black rounded-xl overflow-hidden relative">
        {loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            <Loader2 className="text-brand animate-spin" size={32} />
            <p className="text-gray-400 text-sm">Finding stream for episode {episode}…</p>
          </div>
        ) : error || sources.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 px-4">
            <AlertTriangle className="text-brand" size={32} />
            <p className="text-white font-medium text-center">
              No {LANGUAGES.find((l) => l.key === language)?.label} stream available
            </p>
            <p className="text-gray-400 text-sm text-center max-w-xs">
              Try a different language or source above.
            </p>
            <button
              onClick={fetchSources}
              className="flex items-center gap-2 bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : isEmbed && currentSource ? (
          <iframe
            ref={iframeRef}
            key={`${currentSource.url}-${sourceIndex}-${language}`}
            src={currentSource.url}
            className="w-full h-full"
            allowFullScreen
            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
            style={{ border: "none" }}
          />
        ) : currentSource?.type === "m3u8" ? (
          <video
            ref={videoRef}
            className="w-full h-full"
            controls
            autoPlay
            playsInline
            onEnded={onEpisodeEnd}
            onPlay={() => onProgress?.(episode)}
          />
        ) : null}
      </div>

      {/* Source label + manual switcher */}
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">
          Source: <span className="text-brand font-medium">{providerLabel}</span>
        </span>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {sources.map((s, i) => (
            <button
              key={i}
              onClick={() => { setError(false); setSourceIndex(i); }}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors shrink-0 ${
                i === sourceIndex
                  ? "bg-brand text-white"
                  : "bg-surface-2 text-gray-400 hover:text-white"
              }`}
            >
              {s.provider}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
