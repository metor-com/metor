<script>
  // On/off switch (the checkbox look of the platform is too small on phones and too plain on desktop)
  export let checked = false;
  export let onChange;
  export let label = "";
</script>

<button type="button" role="switch" aria-checked={checked} aria-label={label}
  class="relative h-6 w-11 shrink-0 rounded-full transition-colors {checked ? 'bg-zinc-900' : 'bg-zinc-300'}"
  on:click={() => onChange?.(!checked)}>
  <span class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform {checked ? 'translate-x-5' : ''}"></span>
</button>
