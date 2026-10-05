import { useThemeRuntime, type CostumeProps } from './active';

// Character.tsx's hook for holiday costumes: nothing at all unless a theme's chunk is mounted and has put its costumes
// on (kit/costumes.tsx), so a character costs nothing extra the rest of the year.

export function ThemeCostume(props: CostumeProps) {
  const Costume = useThemeRuntime((s) => s.costume);
  return Costume ? <Costume {...props} /> : null;
}
