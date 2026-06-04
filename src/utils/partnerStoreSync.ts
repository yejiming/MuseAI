import { usePartnerStore } from '../stores/usePartnerStore';

export function applyPartnerStoreContent(content: string): boolean {
  if (!content) return false;

  const parsed = JSON.parse(content);
  if (!parsed.state) return false;

  usePartnerStore.setState(parsed.state);
  return true;
}
