import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

export function getStorageUrl(url: string): string {
  if (!url) return '';
  
  // If it's already a full URL, return it
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // If it's a storage path, convert it to a public URL
  if (url.startsWith('public/')) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${supabaseUrl}/storage/v1/object/public/${url}`;
  }
  
  return url;
}