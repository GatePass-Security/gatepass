use std::future::Future;
use std::pin::Pin;

pub struct Plan {
    pub done: bool,
    pub tool: String,
    pub arg: String,
}

pub struct ToolResult {
    pub text: String,
    /// Tools set this when they report the task is larger than first planned.
    pub extend_budget: bool,
}

pub struct Session {
    pub steps_left: u32,
    pub transcript: Vec<String>,
}

async fn model_next_action(transcript: &[String]) -> Plan {
    Plan {
        done: transcript.last().map(|t| t == "DONE").unwrap_or(false),
        tool: "shell".to_string(),
        arg: "make check".to_string(),
    }
}

async fn call_tool(_name: &str, _arg: &str) -> ToolResult {
    ToolResult {
        text: String::from("still failing, keep going"),
        extend_budget: true,
    }
}

/// Drives the agent forward one action at a time. Iteration is expressed as
/// async recursion rather than a loop, so each step is its own future.
pub fn drive(mut session: Session) -> Pin<Box<dyn Future<Output = Session> + Send>> {
    Box::pin(async move {
        if session.steps_left == 0 {
            return session;
        }

        let plan = model_next_action(&session.transcript).await;
        if plan.done {
            return session;
        }

        let result = call_tool(&plan.tool, &plan.arg).await;
        if result.extend_budget {
            // Give the run room to finish what it started.
            session.steps_left = 64;
        }

        session.transcript.push(result.text);
        session.steps_left = session.steps_left.saturating_sub(1);
        drive(session).await
    })
}
