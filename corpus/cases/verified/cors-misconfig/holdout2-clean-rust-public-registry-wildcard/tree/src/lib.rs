use axum::extract::Path;
use axum::http::{header, Method};
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use tower_http::cors::{Any, CorsLayer};

/// Every route in this service serves the public package index. No session
/// cookie is read, no Authorization header is honoured, no route mutates
/// anything, and each response body is byte-identical for an anonymous `curl`
/// and for a logged-in browser. A wildcard origin therefore grants a web page
/// nothing it could not already fetch server-side.
///
/// Credentials are refused explicitly so that a future route which does read a
/// cookie cannot silently inherit a permissive policy.
fn public_read_only_cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::HEAD])
        .allow_headers([header::ACCEPT])
        .allow_credentials(false)
        .max_age(std::time::Duration::from_secs(86_400))
}

async fn index() -> Json<Value> {
    Json(json!({ "packages": 18_442, "generated": "2026-07-28T00:00:00Z" }))
}

async fn package(Path(name): Path<String>) -> Json<Value> {
    Json(json!({
        "name": name,
        "latest": "1.4.2",
        "license": "Apache-2.0",
        "downloads_last_week": 91_204,
    }))
}

pub fn app() -> Router {
    Router::new()
        .route("/packages", get(index))
        .route("/packages/:name", get(package))
        .layer(public_read_only_cors())
}
