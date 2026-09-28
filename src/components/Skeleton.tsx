// Shared pulsing skeleton block for loading.tsx files — dark-theme variant
// (bg-gray-950 app shell) and light-theme variant (the public card page's
// cream #FAF7F2 background) so a loading state never flashes the wrong theme
// before the real page paints.

export function SkeletonBlockLight({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-[#E4DDD4] rounded-lg ${className}`} />;
}
