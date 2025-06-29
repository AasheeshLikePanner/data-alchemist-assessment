import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type EntityType = 'clients' | 'workers' | 'tasks'

export const detectEntityType = (filename: string, sheetNames: string[] = []): EntityType | null => {
  const normalized = filename.toLowerCase()
  if (normalized.includes('client')) return 'clients'
  if (normalized.includes('worker')) return 'workers'
  if (normalized.includes('task')) return 'tasks'
  const normalizedSheets = sheetNames.join('|').toLowerCase()
  if (normalizedSheets.includes('client')) return 'clients'
  if (normalizedSheets.includes('worker')) return 'workers'
  if (normalizedSheets.includes('task')) return 'tasks'
  return null
}
