'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

/**
 * Filters are applied by Lavalink, not by us. lavalink-client exposes helpers
 * on player.filterManager; we call them defensively so a client version that
 * renames one method degrades to a clear message instead of a crash.
 */
const FILTERS = {
  bassboost: { label: 'Bass boost', methods: ['toggleBassboost'] },
  nightcore: { label: 'Nightcore', methods: ['toggleNightcore'] },
  vaporwave: { label: 'Vaporwave', methods: ['toggleVaporwave'] },
  eightd: { label: '8D', methods: ['toggleRotation', 'toggle8D'] },
  karaoke: { label: 'Karaoke (vocal cut)', methods: ['toggleKaraoke'] },
  tremolo: { label: 'Tremolo', methods: ['toggleTremolo'] },
  vibrato: { label: 'Vibrato', methods: ['toggleVibrato'] },
  lowpass: { label: 'Low pass', methods: ['toggleLowPass'] },
};

async function applyFilter(player, key) {
  const spec = FILTERS[key];
  const fm = player.filterManager;
  if (!fm) throw new Error('Filters are not available on this player.');
  for (const method of spec.methods) {
    if (typeof fm[method] === 'function') {
      await fm[method]();
      return spec.label;
    }
  }
  throw new Error(`The "${spec.label}" filter is not supported by this Lavalink version.`);
}

module.exports = {
  data: new SlashCommandBuilder().setName('filter').setDescription('Apply an audio filter')
    .addStringOption((o) => o.setName('name').setDescription('Which filter').setRequired(true)
      .addChoices(
        { name: 'Bass boost', value: 'bassboost' },
        { name: 'Nightcore', value: 'nightcore' },
        { name: 'Vaporwave', value: 'vaporwave' },
        { name: '8D', value: 'eightd' },
        { name: 'Karaoke (vocal cut)', value: 'karaoke' },
        { name: 'Tremolo', value: 'tremolo' },
        { name: 'Vibrato', value: 'vibrato' },
        { name: 'Low pass', value: 'lowpass' },
        { name: 'Reset all', value: 'reset' },
      ))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const name = interaction.options.getString('name', true);

    await interaction.deferReply();

    try {
      if (name === 'reset') {
        await player.filterManager.resetFilters();
        return interaction.editReply({ embeds: [embeds.ok(ctx.config, '🎛️ All filters cleared.')] });
      }
      const label = await applyFilter(player, name);
      return interaction.editReply({
        embeds: [embeds.ok(ctx.config,
          `🎛️ Toggled **${label}**.\n*Filters take a few seconds to take effect.*`)],
      });
    } catch (err) {
      return fail(interaction, ctx.config, err.message);
    }
  },
};
