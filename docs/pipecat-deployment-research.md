# Pipecat Cloud research (not selected)

This note preserves official Pipecat Cloud API findings from the earlier hosting proposal. The user has since explicitly rejected Pipecat Cloud and requested self-hosted open-source Pipecat. These APIs must not be used for the revised implementation unless the user later changes that choice.

Pipecat Cloud provides a private REST API to create agents from a container image or successful build ID, bind region-specific secret sets, list agents, start sessions, inspect per-session CPU/memory metrics and delete agents. Secret-set creation is asynchronous; deployment must wait for `ready`. These capabilities are documented at:

- [Create an Agent](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/endpoint/agent-create)
- [Cloud Builds](https://docs.pipecat.ai/pipecat-cloud/guides/cloud-builds)
- [Secret Sets](https://docs.pipecat.ai/pipecat-cloud/fundamentals/secrets)
- [List Agents](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/endpoint/agent-list-all)
- [Start Session](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/endpoint/start)
- [Get Session Details](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/endpoint/agent-get-session)
- [Delete Agent](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/endpoint/agent-delete)

The selected approach is instead documented in [self-hosted Pipecat research](pipecat-selfhosted-research.md).
