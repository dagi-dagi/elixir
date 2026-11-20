/**
 * Soft, slowly drifting color fields behind every screen. Purely decorative.
 * `contained` fills the nearest positioned parent (the kiosk stage) instead
 * of the viewport.
 */
export function AmbientBackground({ contained = false }: { contained?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none ${contained ? "absolute" : "fixed"} inset-0 -z-10 overflow-hidden`}
    >
      <div
        className="absolute -left-[25%] -top-[10%] aspect-square w-[110%] rounded-full blur-3xl animate-float"
        style={{ background: "radial-gradient(circle, var(--glow-1), transparent 65%)" }}
      />
      <div
        className="absolute -bottom-[10%] -right-[30%] aspect-square w-[100%] rounded-full blur-3xl animate-float"
        style={{
          background: "radial-gradient(circle, var(--glow-2), transparent 65%)",
          animationDelay: "-7s",
        }}
      />
    </div>
  );
}
