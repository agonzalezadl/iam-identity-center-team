//  © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
//  This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
//  http: // aws.amazon.com/agreement or other written agreement between Customer and either
//  Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.

/* Amplify Params - DO NOT EDIT
	API_TEAM_GRAPHQLAPIENDPOINTOUTPUT
	API_AWSPIM_GRAPHQLAPIIDOUTPUT
	ENV
	REGION
Amplify Params - DO NOT EDIT */
import crypto from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { default as fetch, Request } from 'node-fetch';

import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
} from "@aws-sdk/client-athena";

const { Sha256 } = crypto;
const REGION = process.env.REGION || 'us-east-1';
const ATHENA_REGION = process.env.ATHENA_REGION || 'us-east-2';
const GRAPHQL_ENDPOINT = process.env.API_TEAM_GRAPHQLAPIENDPOINTOUTPUT;

// Athena config — variables de entorno en la lambda
const ATHENA_DATABASE = process.env.ATHENA_DATABASE || 'cloudtrail_logs';
const ATHENA_TABLE    = process.env.ATHENA_TABLE    || 'cloudtrail_logs';
const ATHENA_OUTPUT   = process.env.ATHENA_OUTPUT_LOCATION; // s3://bucket/athena-results/

const athena = new AthenaClient({ region: ATHENA_REGION });

const graphqlMutation = /* GraphQL */ `
  mutation UpdateSessions(
    $input: UpdateSessionsInput!
    $condition: ModelSessionsConditionInput
  ) {
    updateSessions(input: $input, condition: $condition) {
      id
      startTime
      endTime
      username
      accountId
      role
      approver_ids
      queryId
      createdAt
      updatedAt
      owner
    }
  }
`;

const updateItem = async (id, queryId) => {
  const variables = { input: { id, queryId } };
  const endpoint = new URL(GRAPHQL_ENDPOINT);

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: REGION,
    service: 'appsync',
    sha256: Sha256,
  });

  const requestToBeSigned = new HttpRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: endpoint.host },
    hostname: endpoint.host,
    body: JSON.stringify({ query: graphqlMutation, variables }),
    path: endpoint.pathname,
  });

  const signed = await signer.sign(requestToBeSigned);
  const request = new Request(endpoint, signed);

  let statusCode = 200;
  let body;
  let response;

  try {
    response = await fetch(request);
    body = await response.json();
    console.log(body);
    if (body.errors) statusCode = 400;
  } catch (error) {
    statusCode = 400;
    body = { errors: [{ status: response?.status, message: error.message }] };
  }

  return { statusCode, body: JSON.stringify(body) };
};

const getQueryStatus = async (queryExecutionId) => {
  try {
    const cmd = new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId });
    const res = await athena.send(cmd);
    return res.QueryExecution.Status.State; // QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED
  } catch (err) {
    console.log("Error getting Athena query status", err);
    return 'FAILED';
  }
};

const startQuery = async (event) => {
  const startTime = event["startTime"]["S"];
  const endTime   = event["endTime"]["S"];
  const username  = event["username"]["S"].replace('idc_', '');
  const accountId = event["accountId"]["S"];
  const role      = event["role"]["S"];

  // Extraer rangos de fecha para las particiones
  const start = new Date(startTime);
  const end   = new Date(endTime);

  // Construir filtros de partición para cubrir el rango de fechas
  // Usamos año/mes del inicio y fin — cubre sesiones de hasta 1 mes
  const startYear  = String(start.getUTCFullYear());
  const startMonth = String(start.getUTCMonth() + 1).padStart(2, '0');
  const startDay   = String(start.getUTCDate()).padStart(2, '0');
  const endYear    = String(end.getUTCFullYear());
  const endMonth   = String(end.getUTCMonth() + 1).padStart(2, '0');
  const endDay     = String(end.getUTCDate()).padStart(2, '0');

  // Partition projection — incluir días del rango
  // Para simplificar: si mismo mes, filtrar día exacto; si distinto mes, filtrar por año/mes
  let partitionFilter;
  if (startYear === endYear && startMonth === endMonth) {
    if (startDay === endDay) {
      partitionFilter = `account_id = '${accountId}' AND year = '${startYear}' AND month = '${startMonth}' AND day = '${startDay}'`;
    } else {
      partitionFilter = `account_id = '${accountId}' AND year = '${startYear}' AND month = '${startMonth}' AND day BETWEEN '${startDay}' AND '${endDay}'`;
    }
  } else {
    partitionFilter = `account_id = '${accountId}' AND year = '${startYear}' AND month = '${startMonth}'`;
  }

  // Athena SQL con particiones para eficiencia
  const sql = `
    SELECT eventid, eventname, eventsource, eventtime
    FROM ${ATHENA_DATABASE}.${ATHENA_TABLE}
    WHERE ${partitionFilter}
      AND eventtime >= '${startTime}'
      AND eventtime <= '${endTime}'
      AND lower(useridentity.principalid) LIKE '%:${username.toLowerCase()}%'
      AND useridentity.sessioncontext.sessionissuer.arn LIKE '%${role}%'
      AND recipientaccountid = '${accountId}'
    LIMIT 1000
  `;

  console.log("Athena SQL:", sql);

  try {
    const cmd = new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: ATHENA_DATABASE },
      ResultConfiguration: { OutputLocation: ATHENA_OUTPUT },
    });
    const res = await athena.send(cmd);
    return res.QueryExecutionId;
  } catch (err) {
    console.log("Error starting Athena query", err);
    throw err;
  }
};

export const handler = async (event) => {
  let data = event["Records"].pop();
  data = data["dynamodb"]["NewImage"];
  const id = data["id"]["S"];
  console.log("Event", data);

  const queryExecutionId = await startQuery(data);
  console.log("Athena QueryExecutionId:", queryExecutionId);

  // Esperar hasta SUCCEEDED o FAILED (máx ~25s para no timeout de Lambda)
  let status = await getQueryStatus(queryExecutionId);
  let attempts = 0;
  while (['QUEUED', 'RUNNING'].includes(status) && attempts < 25) {
    await new Promise(r => setTimeout(r, 1000));
    status = await getQueryStatus(queryExecutionId);
    attempts++;
    console.log(`Athena status [${attempts}]: ${status}`);
  }

  if (status === 'SUCCEEDED') {
    console.log("Query finished — saving queryId:", queryExecutionId);
    const response = await updateItem(id, queryExecutionId);
    return response;
  } else {
    console.log("Query did not succeed:", status);
    return { statusCode: 500, body: JSON.stringify({ error: `Athena query ${status}` }) };
  }
};
