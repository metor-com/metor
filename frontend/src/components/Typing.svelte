<script>
  // Three dots lighting up one after another: the bot is thinking or writing (bot list)
  export let cls = "text-zinc-500";
</script>

<span class="typing inline-flex h-5 items-center gap-[3px] {cls}" role="status" aria-label="working">
  <span></span><span></span><span></span>
</span>

<style>
  .typing span { width: 5px; height: 5px; border-radius: 9999px; background: currentColor; opacity: 0.25; animation: typing 1.2s infinite ease-in-out; }
  .typing span:nth-child(2) { animation-delay: 0.2s; }
  .typing span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .typing span { animation: none; opacity: 0.6; } }
</style>
