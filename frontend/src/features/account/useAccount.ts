import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'

export interface Profile {
  id: number
  name: string
  email: string
  phone: string
  age: number | null
}

export interface Guardian {
  name: string
  email: string
  phone: string
  relationship: string
}

export const PROFILE_KEY = ['profile'] as const
export const GUARDIAN_KEY = ['guardian'] as const

export function useProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: () => api.get<Profile>('/profile') })
}

export function useSaveProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; age: number | null; email: string; phone: string }) =>
      api.put<Profile>('/profile', body),
    onSuccess: (data) => qc.setQueryData(PROFILE_KEY, data),
  })
}

export function useGuardian() {
  return useQuery({ queryKey: GUARDIAN_KEY, queryFn: () => api.get<Guardian>('/guardian') })
}

export function useSaveGuardian() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Guardian) => api.put<Guardian>('/guardian', body),
    onSuccess: (data) => qc.setQueryData(GUARDIAN_KEY, data),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post<{ message: string }>('/profile/change-password', body),
  })
}

/** True when the guardian has been filled in (the API returns empty strings when unset). */
export function guardianIsSet(g: Guardian | undefined): boolean {
  return !!g && !!g.name && !!g.email && !!g.phone
}
