/**
 * domain_profile_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A2 only
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

export interface DomainProfileRegistry {
  schema_version: "0.1.0";
  profiles: { [propertyId: string]: DomainProfile };
}

export interface DomainProfile {
  property_id: string;
  domain_type:
    | "job_board" | "ecommerce" | "saas" | "media_blog"
    | "marketplace" | "lead_gen" | "education" | "other";
  display_name?: string;
  key_engagement_events?: string[];
  key_conversion_events?: string[];
  funnel_template?: FunnelStep[];
  page_classification?: { rules: Array<{ pattern: string; role: string; match?: string }> };
  notes?: string;
}

export type FunnelStep = {
  label: string;
  event_match: string | { any_of: string[] };
  page_filter?: string;
};

export const readDomainProfiles: RegistryReader<DomainProfileRegistry> =
  createRegistryReader<DomainProfileRegistry>({
    fileName: "domain-profile.json",
    schemaName: "domainProfile",
    toolName: "domain_profile_reader",
  });

export async function getProfileFor(propertyId: string): Promise<DomainProfile | undefined> {
  const reg = await readDomainProfiles();
  return reg.profiles[propertyId];
}
