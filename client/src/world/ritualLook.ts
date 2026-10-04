// What the rituals (Rituals.tsx) do to the look of the floor you're on: how far the desk lamps are on and the main
// lights are down for the evening (0 to 1, eased every frame there and read by DayLights.tsx), and whether the merge
// confetti comes in pizza colours (Friday pizza, MergeConfetti.tsx). Plain module state: nothing re-renders for it.

export const ritualLook = { lamps: 0, dim: 0, pizza: false };

/** How far the main lights go down when a floor has wound down for the evening (a share of their brightness). */
export const DIM_BY = 0.2;

/** The confetti while the pizza's out: cheese, tomato, pepperoni, crust, basil. */
export const PIZZA_CONFETTI = ['#f6bd60', '#e63946', '#c1121f', '#d08c45', '#80ed99', '#fff3b0'];

/** Back to normal: the floor went away. */
export function resetRitualLook() {
  ritualLook.lamps = 0;
  ritualLook.dim = 0;
  ritualLook.pizza = false;
}
