<script>
  // A bot's picture at a given size: the uploaded image, else initials on its colour.
  import { imageUrl, lookOf, textOn } from "../lib/avatar.js";
  export let agent = null;      // the bot (list entry)
  export let look = null;       // { initials, color } – overrides the bot's (the create dialog's preview)
  export let image = null;      // an image URL – overrides (a chosen file's preview)
  export let size = 44;         // px
  $: src = image ?? imageUrl(agent);
  $: l = look ?? lookOf(agent);
  $: font = Math.round(size * (l.initials.length >= 3 ? 0.34 : l.initials.length === 2 ? 0.42 : 0.5));
</script>

{#if src}
  <img class="shrink-0 rounded-full bg-zinc-200 object-cover" style="width:{size}px;height:{size}px" {src} alt="" />
{:else}
  <span class="flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none" style="width:{size}px;height:{size}px;font-size:{font}px;background:{l.color};color:{textOn(l.color)}">{l.initials}</span>
{/if}
