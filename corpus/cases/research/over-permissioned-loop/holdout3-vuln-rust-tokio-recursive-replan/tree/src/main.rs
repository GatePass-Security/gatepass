mod agent;

use agent::{drive, Session};

#[tokio::main]
async fn main() {
    let session = Session {
        steps_left: 8,
        transcript: vec!["fix the failing integration tests".to_string()],
    };

    let finished = drive(session).await;
    println!("{} transcript entries", finished.transcript.len());
}
