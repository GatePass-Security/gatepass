use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::ConfigMap;
use kube::api::{Api, Patch, PatchParams};
use kube::Client;

const NAMESPACE: &str = "apps";

/// Tool: reconcile_drift.
///
/// Runs as ServiceAccount apps/drift-agent. Every verb used here is granted
/// by the drift-agent-remediate Role in deploy/rbac.yaml.
pub async fn reconcile(client: Client, name: &str, desired_policy: &str) -> kube::Result<()> {
    let params = PatchParams::apply("drift-agent");

    let maps: Api<ConfigMap> = Api::namespaced(client.clone(), NAMESPACE);
    let policy = serde_json::json!({
        "data": { "policy.yaml": desired_policy }
    });
    maps.patch(name, &params, &Patch::Merge(&policy)).await?;

    let deployments: Api<Deployment> = Api::namespaced(client, NAMESPACE);
    let current = deployments.get(name).await?;
    let generation = current.metadata.generation.unwrap_or_default();

    let bump = serde_json::json!({
        "spec": { "template": { "metadata": { "annotations": {
            "drift-agent/reloaded-generation": generation.to_string()
        }}}}
    });
    deployments.patch(name, &params, &Patch::Merge(&bump)).await?;

    Ok(())
}
