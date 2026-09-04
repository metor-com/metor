<script>
  // Delivery ticks of a sent message, messenger style: one tick = on its way to the bot,
  // two grey ticks = the bot's session has taken it, two green ticks = the bot has answered.
  export let state = "sent";   // sent | delivered | answered
  const titles = { sent: "sent – on its way to the bot", delivered: "delivered – the bot has taken it", answered: "answered" };
</script>

<svg class="inline-block h-3 w-5 shrink-0 {state === 'answered' ? 'text-emerald-400' : 'text-zinc-400'}" viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label={titles[state] ?? state}>
  <title>{titles[state] ?? state}</title>
  <path d="M1 6.5l3.5 3.5L11 3" />
  {#if state !== "sent"}<path d="M8 6.5l3.5 3.5L18 3" />{/if}
</svg>
