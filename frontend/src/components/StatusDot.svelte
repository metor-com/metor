<script>
  export let status = "stopped";
  const color = { idle: "bg-emerald-500", busy: "bg-amber-500", waiting: "bg-red-500" };
</script>

<span class="inline-block size-2.5 shrink-0 rounded-full {color[status] ?? 'bg-zinc-300'}" aria-hidden="true"></span>
