import type { RequestFn } from "../request";

export type IntegrationCatalogProvider = {
  provider_id: string;
  display_name: string;
  description: string;
  auth_modes: string[];
  supports_oss: boolean;
  supports_managed: boolean;
  default_scopes: string[];
  docs_url: string | null;
};

export type IntegrationCatalogResponse = {
  providers: IntegrationCatalogProvider[];
};

export type IntegrationsMethods = {
  listCatalog(): Promise<IntegrationCatalogResponse>;
};

export function makeIntegrationsMethods(
  request: RequestFn
): IntegrationsMethods {
  return {
    listCatalog() {
      return request<IntegrationCatalogResponse>({
        method: "GET",
        path: "/api/v1/integrations/catalog",
      });
    },
  };
}
