export interface DemoProfile {
  id: string
  name: string
  role: string
  color: string
  initials: string
}

export const DEMO_PROFILES: DemoProfile[] = [
  { id: 'demo-user', name: 'Johnny Martin', role: 'Product designer', color: '#007AFF', initials: 'JM' },
  { id: 'alice', name: 'Alice Bernard', role: 'Product manager', color: '#AF52DE', initials: 'AB' },
  { id: 'bob', name: 'Bob Laurent', role: 'Engineering', color: '#00A67E', initials: 'BL' },
]

export function findDemoProfile(id: string): DemoProfile | undefined {
  return DEMO_PROFILES.find((profile) => profile.id === id)
}
