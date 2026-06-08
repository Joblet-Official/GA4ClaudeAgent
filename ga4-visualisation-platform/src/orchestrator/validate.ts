/**
 * Catalog grounding — rejects any GA4 query referring to a dimension or metric
 * name not present in catalog/ga4_catalog.json.
 *
 * This is the line of defence against Brain 2 hallucinating field names. The
 * orchestrator must call this immediately after Brain 2 returns and before the
 * Tool Layer runs.
 *
 * Walks dimensions[], metrics[], orderBys[], and recursively into
 * dimensionFilter/metricFilter (GA4 nests fieldName references inside
 * andGroup/orGroup/notExpression).
 */
import type { Catalog } from "@/support/catalog/loadCatalog";
import type { MetricsOutput, Query } from "@/schemas/metrics";

export interface CatalogValidationIssue {
  query_id: string;
  kind: "dimension" | "metric" | "filter_field";
  name: string;
  location: string;
}

export interface CatalogValidationResult {
  ok: boolean;
  issues: CatalogValidationIssue[];
}

/**
 * Some GA4 metric filters reference dimension fields and vice versa. We treat
 * any unknown name as invalid regardless of where it appears.
 */
function isKnownField(catalog: Catalog, name: string): boolean {
  return (
    catalog._dimensionNames!.has(name) || catalog._metricNames!.has(name)
  );
}

function walkFilter(
  expr: unknown,
  catalog: Catalog,
  queryId: string,
  location: string,
  issues: CatalogValidationIssue[],
): void {
  if (expr == null || typeof expr !== "object") return;
  const node = expr as Record<string, unknown>;

  // filter: { fieldName, stringFilter | numericFilter | ... }
  if (node["filter"] && typeof node["filter"] === "object") {
    const f = node["filter"] as Record<string, unknown>;
    const fieldName = f["fieldName"];
    if (typeof fieldName === "string" && !isKnownField(catalog, fieldName)) {
      issues.push({
        query_id: queryId,
        kind: "filter_field",
        name: fieldName,
        location: `${location}.filter.fieldName`,
      });
    }
  }

  // andGroup / orGroup: { expressions: [...] }
  for (const groupKey of ["andGroup", "orGroup"]) {
    const group = node[groupKey];
    if (group && typeof group === "object") {
      const exprs = (group as Record<string, unknown>)["expressions"];
      if (Array.isArray(exprs)) {
        exprs.forEach((e, i) =>
          walkFilter(e, catalog, queryId, `${location}.${groupKey}.expressions[${i}]`, issues),
        );
      }
    }
  }

  // notExpression: <FilterExpression>
  if (node["notExpression"]) {
    walkFilter(node["notExpression"], catalog, queryId, `${location}.notExpression`, issues);
  }
}

function validateQuery(query: Query, catalog: Catalog, issues: CatalogValidationIssue[]): void {
  const body = query.request_body;

  body.dimensions.forEach((d, i) => {
    if (!catalog._dimensionNames!.has(d.name)) {
      issues.push({
        query_id: query.id,
        kind: "dimension",
        name: d.name,
        location: `request_body.dimensions[${i}].name`,
      });
    }
  });

  body.metrics.forEach((m, i) => {
    if (!catalog._metricNames!.has(m.name)) {
      issues.push({
        query_id: query.id,
        kind: "metric",
        name: m.name,
        location: `request_body.metrics[${i}].name`,
      });
    }
  });

  if (body.orderBys) {
    body.orderBys.forEach((o, i) => {
      if (o.metric && !catalog._metricNames!.has(o.metric.metricName)) {
        issues.push({
          query_id: query.id,
          kind: "metric",
          name: o.metric.metricName,
          location: `request_body.orderBys[${i}].metric.metricName`,
        });
      }
      if (o.dimension && !catalog._dimensionNames!.has(o.dimension.dimensionName)) {
        issues.push({
          query_id: query.id,
          kind: "dimension",
          name: o.dimension.dimensionName,
          location: `request_body.orderBys[${i}].dimension.dimensionName`,
        });
      }
    });
  }

  if (body.dimensionFilter) {
    walkFilter(body.dimensionFilter, catalog, query.id, "request_body.dimensionFilter", issues);
  }
  if (body.metricFilter) {
    walkFilter(body.metricFilter, catalog, query.id, "request_body.metricFilter", issues);
  }
}

export function validateAgainstCatalog(
  output: MetricsOutput,
  catalog: Catalog,
): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];
  for (const query of output.queries) {
    validateQuery(query, catalog, issues);
  }
  return { ok: issues.length === 0, issues };
}
