use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

/// The index is meant to be embeddable by any documentation site, playground or
/// dashboard, so the wildcard is a product requirement and this test locks it
/// in. It also pins the other half of the contract: credentials must never be
/// allowed, or the wildcard would stop being safe.
#[tokio::test]
async fn public_metadata_is_world_readable() {
    let response = registry_api::app()
        .oneshot(
            Request::builder()
                .uri("/packages/serde")
                .header(header::ORIGIN, "https://some-random-site.test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "*"
    );
    assert!(response
        .headers()
        .get("access-control-allow-credentials")
        .is_none());
}
