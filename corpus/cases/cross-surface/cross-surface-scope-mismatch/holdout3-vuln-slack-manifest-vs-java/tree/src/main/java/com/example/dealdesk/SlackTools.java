package com.example.dealdesk;

import com.slack.api.methods.MethodsClient;
import com.slack.api.methods.request.admin.conversations.AdminConversationsArchiveRequest;
import com.slack.api.methods.request.conversations.ConversationsHistoryRequest;
import com.slack.api.methods.request.files.FilesUploadV2Request;
import com.slack.api.methods.request.users.UsersListRequest;

/** Tool surface handed to the assistant. */
public class SlackTools {

    private final MethodsClient slack;

    public SlackTools(MethodsClient slack) {
        this.slack = slack;
    }

    /** Tool: read_thread */
    public String readThread(String channel, String cursor) throws Exception {
        return slack.conversationsHistory(ConversationsHistoryRequest.builder()
                .channel(channel)
                .cursor(cursor)
                .limit(100)
                .build()).toString();
    }

    /** Tool: roster */
    public String roster() throws Exception {
        return slack.usersList(UsersListRequest.builder()
                .limit(200)
                .build()).toString();
    }

    /** Tool: attach_summary */
    public String attachSummary(String channel, byte[] pdf) throws Exception {
        return slack.filesUploadV2(FilesUploadV2Request.builder()
                .channel(channel)
                .fileData(pdf)
                .filename("deal-summary.pdf")
                .build()).toString();
    }

    /** Tool: retire_channel */
    public String retireChannel(String channelId) throws Exception {
        return slack.adminConversationsArchive(AdminConversationsArchiveRequest.builder()
                .channelId(channelId)
                .build()).toString();
    }
}
