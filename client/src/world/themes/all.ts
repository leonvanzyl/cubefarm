// Every holiday theme's scene, as one lazy chunk (ThemeLayer.tsx loads it only while a theme is on). One chunk rather
// than one per theme: with several lazy entries sharing the office's modules, the bundler splits those modules out of
// the main bundle into extra chunks that every page load fetches, which costs more than ~25 kB of themes on a holiday.
export { default as halloween } from './halloween';
export { default as christmas } from './christmas';
export { default as newyear } from './newyear';
export { default as valentines } from './valentines';
export { default as easter } from './easter';
export { default as birthday } from './birthday';
