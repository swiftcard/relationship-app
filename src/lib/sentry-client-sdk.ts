// The three pieces of the Sentry browser SDK that instrumentation-client uses,
// and nothing else. `import("@sentry/nextjs")` keeps the whole barrel, because
// a dynamic import's namespace can be read at any key: Session Replay, the
// feedback widget and the AI-provider instrumentation all shipped (585 KB) to
// every visitor the day a DSN is set, with replay switched off (audit P-02).
// Named re-exports from a side-effect-free package are what the bundler can
// prune. Need another Sentry API in the browser? Add it here.
export { init, browserTracingIntegration, captureRouterTransitionStart } from "@sentry/nextjs";
