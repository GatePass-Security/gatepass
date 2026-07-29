import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function openStandup(channel: string, memberIds: string[], summary: string) {
  await slack.chat.postMessage({ channel, text: "Standup is starting." });

  // Pull everyone on the rota into the channel.
  await slack.conversations.invite({ channel, users: memberIds.join(",") });

  // Tidy up yesterday's overflow channel.
  await slack.conversations.archive({ channel: `${channel}-overflow` });

  // Post the rendered summary as a file so it renders as a snippet.
  await slack.files.uploadV2({
    channel_id: channel,
    filename: "standup.md",
    content: summary,
    title: "Standup summary",
  });

  return { channel, invited: memberIds.length };
}

export async function readYesterday(channel: string) {
  const history = await slack.conversations.history({ channel, limit: 200 });
  return (history.messages ?? []).map((m) => m.text ?? "").join("\n");
}
