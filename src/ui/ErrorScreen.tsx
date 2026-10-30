
/**
 * Last-resort recovery screen. React used an error boundary; without React we
 * catch uncaught errors in main.tsx and swap the app for this panel.
 */
export function errorScreen(message: string) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-ink p-6">
      <div className="cut glass neon-border max-w-md p-6 text-center">
        <div className="font-display text-lg font-black uppercase tracking-[0.2em] text-neon-pink">Something broke</div>
        <p className="mt-2 text-sm text-white/65">NEON RIOT hit an unexpected error. Your scores and settings are saved. Reloading usually fixes it.</p>
        <p className="mt-2 break-words font-display text-[10px] uppercase tracking-widest text-white/35">{message}</p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="cut-sm mt-4 bg-neon-pink px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.18em] text-white hover:bg-white hover:text-ink"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
