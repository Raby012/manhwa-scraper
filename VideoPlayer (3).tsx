"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamSource, Language } from "@/lib/embed-sources";
import {
  getEmbedSources,
  getAnilistEmbedSources,
  getMalEmbedSources,
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

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(false);
    setAllSources([]);
    setSourceIndex(0);

    // Phase 1 — instant embed sources, no API calls needed
    const instant: StreamSource[] = [
      ...getAnilistEmbedSources(anilistId, episode, isMovie, malId),
      ...(malId ? getMalEmbedSources(malId, episode, isMovie) : []),
      ...(imdbId || tmdbId
        ? getEmbedSources(imdbId ?? null, tmdbId ?? null, season, episode, isMovie)
        : []),
    ];
    setAllSources(instant);
    setLoading(false);

    // Phase 2 — async API sources added as they resolve
    const base    = `/api/stream?title=${encodeURIComponent(animeTitle)}&episode=${episode}`;
    const seasonQ = `&season=${season}${seasonYear ? `&year=${seasonYear}` : ""}`;

    const apiFetches: Promise<StreamSource[]>[] = [
      fetch(`${base}&provider=indian`).then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => [] as StreamSource[]),
      fetch(`${base}&provider=megaplay`).then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => [] as StreamSource[]),
      fetch(`${base}&provider=hianime`).then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => [] as StreamSource[]),
      fetch(`${base}&provider=anikoto`).then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => [] as StreamSource[]),
      fetch(`${base}${seasonQ}&provider=tmdb`).then((r) => r.json()).then((d) => (d.sources ?? []) as StreamSource[]).catch(() => [] as StreamSource[]),
      fetch(`${base}&provider=gogoanime`).then((r) => r.json()).then((d) => ((d.sources ?? []) as StreamSource[]).map((s) => ({ ...s, lang: "sub" as const }))).catch(() => [] as StreamSource[]),
      fetch(`${base}&provider=animepahe`).then((r) => r.json()).then((d) => ((d.sources ?? []) as StreamSource[]).map((s) => ({ ...s, lang: "sub" as const }))).catch(() => [] as StreamSource[]),
    ];

    apiFetches.forEach((p) =>
      p.then((newSrcs) => {
        if (!newSrcs.length) return;
        setAllSources((prev) => {
          const seen  = new Set(prev.map((s) => s.url));
          const fresh = newSrcs.filter((s) => !seen.has(s.url));
          const m3u8s  = fresh.filter((s) => s.type === "m3u8");
          const embeds = fresh.filter((s) => s.type === "embed");
          return [...m3u8s, ...prev, ...embeds];
        });
      })
    );
  }, [animeTitle, anilistId, malId, episode, season, seasonYear, imdbId, tmdbId, isMovie]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  // Reset on language change
  useEffect(() => {
    setSourceIndex(0);
    setError(false);
  }, [language]);

  // Load source whenever index changes
  useEffect(() => {
    if (loading || !sources.length) return;
    const src = sources[sourceIndex];
    if (!src) { setError(true); return; }
    setProviderLabel(src.provider);
    // m3u8 only — embeds render via iframe, nothing to "load" here
    if (src.type === "m3u8") {
      loadHLS(src.url, src.subtitles);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, sourceIndex, loading]);

  // postMessage — only track progress/completion, NEVER auto-advance
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.event === "complete") onEpisodeEnd?.();
        if (
          (data?.event === "time" && data.percent > 0.05) ||
          (data?.type === "watching-log" && data.currentTime > 30)
        ) {
          onProgress?.(episode);
        }
        // ALL error events ignored — user switches source manually
      } catch {}
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [episode, onEpisodeEnd, onProgress]);

  async function loadHLS(url: string, subtitles?: { url: string; lang: string }[]) {
    if (typeof window === "undefined") return;
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) {
      (hlsRef.current as { destroy: () => void }).destroy();
      hlsRef.current = null;
    }
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
          // m3u8 fatal error → try next m3u8 source, but don't touch embed sources
          if (data.fatal) {
            const nextIdx = sourceIndex + 1;
            if (nextIdx < sources.length && sources[nextIdx]?.type === "m3u8") {
              setSourceIndex(nextIdx);
            }
            // if next source is an embed, do nothing — let user pick
          }
        });
      }
      // if HLS not supported, do nothing — user picks another source
    }
  }

  const currentSource = sources[sourceIndex];

  const langCounts = LANGUAGES.reduce(
    (acc, l) => {
      acc[l.key] = allSources.filter((s) => (s.lang ?? "sub") === l.key).length;
      return acc;
    },
    {} as Record<Language, number>
  );

  return (
    <div className="w-full">
      {/* Language tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-1">
        {LANGUAGES.map((l) => {
          const count = langCounts[l.key] || 0;
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
        ) : currentSource?.type === "embed" ? (
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
              onClick={() => {
                setError(false);
                setSourceIndex(i);
              }}
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
