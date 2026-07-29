def test_router_uses_supplied_token(agent_mock, make_slack_mock, mock_cls):
    mock_cls.return_value = make_slack_mock(token="xoxb-explicit-token")
    app = build_app(agent_mock, token="xoxb-explicit-token")
    assert app.slack.token == "xoxb-explicit-token"
