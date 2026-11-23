import {
  Smartphone, Laptop, Tv, Shirt, Footprints, Briefcase, Home, Armchair, Car, Sparkles,
  Baby, Dumbbell, Hammer, BookOpen, PawPrint, LayoutGrid,
} from 'lucide-react';

const MAP = { Smartphone, Laptop, Tv, Shirt, Footprints, Briefcase, Home, Armchair, Car, Sparkles, Baby, Dumbbell, Hammer, BookOpen, PawPrint, LayoutGrid };
export const iconFor = (key) => MAP[key] || LayoutGrid;

// Цвет плитки категории (подложка, иконка) — по порядку в каталоге
export const TILE_TONES = [
  ['#e9eefd', '#1f4fe0'], ['#e3f6ee', '#0f9d6e'], ['#fdecec', '#e5484d'], ['#fff3dc', '#c77d0a'],
  ['#efeaff', '#6a4cf0'], ['#e3f4fd', '#0b84c0'], ['#e0f7f4', '#0e9488'], ['#fde8f3', '#d6338a'],
];
