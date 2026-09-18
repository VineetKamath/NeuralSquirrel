/**
 * Biological parameters used by the simulation, with the basis for each value.
 * Values are approximations drawn from established models or commonly reported
 * ranges for the eastern gray squirrel (Sciurus carolinensis); they are used to
 * scale behaviour, not to make precise physiological predictions.
 */

export interface Parameter {
  value: number;
  unit: string;
  basis: string;
}

export const SQUIRREL = {
  bodyMass: { value: 0.52, unit: "kg", basis: "adult eastern gray squirrel, typical range 0.4–0.7 kg" },
  bmr: {
    value: 293 * Math.pow(0.52, 0.75),
    unit: "kJ/day",
    basis: "Kleiber's law, BMR ≈ 293·M^0.75 kJ/day (M in kg)",
  },
  fieldMetabolicMultiple: { value: 2.4, unit: "× BMR", basis: "free-living mammals typically expend ~2–3× BMR" },
  lowerCriticalTemp: { value: 10, unit: "°C", basis: "approximate; below this, thermoregulation raises energy cost" },
  thermalCostPerDegree: { value: 0.025, unit: "fraction/°C", basis: "approximate increase in metabolic rate per °C below the lower critical temperature" },
  acornEnergy: { value: 38, unit: "kJ", basis: "one oak acorn kernel ≈ 2–3 g at ≈ 16 kJ/g" },
  sprintSpeed: { value: 5.5, unit: "m/s", basis: "short sprints up to roughly 5–8 m/s are reported" },
  homeRangeRadius: { value: 55, unit: "m", basis: "urban gray squirrels commonly use ~1 ha or less at high density" },
} satisfies Record<string, Parameter>;

/** daily field energy requirement in kJ at a given air temperature */
export function dailyEnergyNeed(tempC: number) {
  const base = SQUIRREL.bmr.value * SQUIRREL.fieldMetabolicMultiple.value;
  const cold = Math.max(0, SQUIRREL.lowerCriticalTemp.value - tempC) * SQUIRREL.thermalCostPerDegree.value;
  return base * (1 + cold);
}

/** published spiking-neuron and plasticity parameters used by the neural model */
export const NEURAL = {
  izhikevichRS: { a: 0.02, b: 0.2, c: -65, d: 8, basis: "Izhikevich (2003) regular-spiking cortical neuron" },
  izhikevichFS: { a: 0.1, b: 0.2, c: -65, d: 2, basis: "Izhikevich (2003) fast-spiking interneuron" },
  izhikevichMSN: { a: 0.02, b: 0.25, c: -65, d: 6, basis: "regular-spiking variant used for striatal medium spiny neurons" },
  stdpTau: { value: 20, unit: "ms", basis: "Song, Miller & Abbott (2000) STDP time constants" },
  stdpAPlus: { value: 0.01, unit: "", basis: "STDP potentiation amplitude (relative)" },
  stdpAMinus: { value: 0.012, unit: "", basis: "slightly larger depression keeps weights stable" },
  eligibilityTau: { value: 1000, unit: "ms", basis: "dopamine-gated eligibility traces ~1 s (Izhikevich 2007)" },
  thetaHz: { value: 8, unit: "Hz", basis: "hippocampal theta rhythm in rodents, ~6–10 Hz" },
  gridScaleRatio: { value: 1.42, unit: "", basis: "grid modules scale by ≈ √2 (Stensola et al. 2012)" },
  hdTuningWidth: { value: 45, unit: "°", basis: "head-direction cell tuning widths of tens of degrees (Taube et al. 1990)" },
  replayCompression: { value: 15, unit: "×", basis: "sharp-wave ripple replay is time-compressed ~10–20×" },
};

export const REFERENCES = [
  "Kleiber M. (1932) Body size and metabolism. Hilgardia.",
  "Izhikevich E.M. (2003) Simple model of spiking neurons. IEEE Trans. Neural Networks.",
  "Izhikevich E.M. (2007) Solving the distal reward problem through linkage of STDP and dopamine signaling. Cerebral Cortex.",
  "Song S., Miller K.D., Abbott L.F. (2000) Competitive Hebbian learning through spike-timing-dependent synaptic plasticity. Nature Neuroscience.",
  "Frémaux N., Sprekeler H., Gerstner W. (2013) Reinforcement learning using a continuous time actor-critic framework with spiking neurons. PLoS Comput Biol.",
  "Schultz W., Dayan P., Montague P.R. (1997) A neural substrate of prediction and reward. Science.",
  "Taube J.S., Muller R.U., Ranck J.B. (1990) Head-direction cells recorded from the postsubiculum. J Neurosci.",
  "Hafting T. et al. (2005) Microstructure of a spatial map in the entorhinal cortex. Nature.",
  "Stensola H. et al. (2012) The entorhinal grid map is discretized. Nature.",
  "O'Keefe J., Dostrovsky J. (1971) Units in the hippocampus of the rat responsive to spatial position.",
  "Foster D.J., Knierim J.J. (2012) Sequence learning and the role of the hippocampus in rodent navigation / hippocampal replay literature.",
  "Jacobs L.F., Liman E.R. (1991) Grey squirrels remember the locations of buried nuts. Animal Behaviour.",
  "2018 Central Park Squirrel Census — NYC Open Data.",
];
