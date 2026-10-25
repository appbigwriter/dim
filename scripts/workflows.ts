import { writeFileSync } from "node:fs";
const names = [
  "identity.onboard",
  "identity.audit",
  "content.research",
  "content.generate",
  "content.verify",
  "content.approve",
  "social.publish",
  "social.metrics",
  "inbox.triage",
  "campaign.track",
  "security.monitor",
  "identity.offboard",
];
for (const name of names) {
  const executable = ["content.generate", "content.verify"].includes(name);
  const nodes: any[] = [
    {
      id: "entry",
      name: "DIM authenticated command",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        httpMethod: "POST",
        path: `dim/${name}`,
        authentication: "headerAuth",
        responseMode: "lastNode",
      },
      credentials: { httpHeaderAuth: { name: "DIM inbound service" } },
    },
  ];
  if (executable)
    nodes.push({
      id: "execute",
      name: "Execute bounded DIM operation",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [300, 0],
      parameters: {
        method: "POST",
        url: '={{ $env.DIM_API_INTERNAL_URL + "/api/v1/automation/execute" }}',
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({ operation_id: $json.body.operation_id }) }}",
        options: { timeout: 90000 },
      },
      credentials: { httpHeaderAuth: { name: "DIM outbound service" } },
    });
  else
    nodes.push({
      id: "handoff",
      name: "Preserve request for human workflow",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [300, 0],
      parameters: {
        jsCode: `const command = $input.first().json.body;\nif (!command?.operation_id || !command?.organization_id) throw new Error('Invalid DIM command');\nreturn [{json: {completed:false, requires_human:true, workflow:${JSON.stringify(name)}, operation_id:command.operation_id, reason:'Configure and validate the organization-specific workflow before automation.'}}];`,
      },
    });
  writeFileSync(
    `n8n/workflows/${name}.json`,
    JSON.stringify(
      {
        name: `DIM · ${name}`,
        active: false,
        nodes,
        connections: {
          "DIM authenticated command": {
            main: [[{ node: nodes[1].name, type: "main", index: 0 }]],
          },
        },
        settings: {
          executionOrder: "v1",
          saveDataSuccessExecution: "none",
          saveDataErrorExecution: "none",
        },
        tags: [],
      },
      null,
      2,
    ),
  );
}
console.log(
  "12 importable workflows written; 2 execute bounded backend commands, 10 require configuration/human handling.",
);
