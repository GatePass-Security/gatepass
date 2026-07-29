use registry_api::app;

#[tokio::main]
async fn main() {
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("bind :8080");

    println!(
        "public registry index listening on {}",
        listener.local_addr().expect("local addr")
    );

    axum::serve(listener, app()).await.expect("serve");
}
