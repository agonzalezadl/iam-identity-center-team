//  © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
//  This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
//  http: // aws.amazon.com/agreement or other written agreement between Customer and either
//  Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.

const { AthenaClient, GetQueryResultsCommand } = require("@aws-sdk/client-athena");

const REGION = process.env.REGION || 'us-east-1';
const client = new AthenaClient({ region: REGION });

const getQueryResults = async (queryExecutionId) => {
  try {
    const output = [];
    let nextToken = undefined;

    do {
      const input = {
        QueryExecutionId: queryExecutionId,
        ...(nextToken && { NextToken: nextToken }),
      };
      const cmd = new GetQueryResultsCommand(input);
      const res = await client.send(cmd);

      const rows = res.ResultSet.Rows;
      // Primera fila son los headers — saltarla en páginas siguientes
      const startIdx = nextToken ? 0 : 1;

      for (let i = startIdx; i < rows.length; i++) {
        const row = rows[i];
        const log = {
          eventID:     row.Data[0]?.VarCharValue || '',
          eventName:   row.Data[1]?.VarCharValue || '',
          eventSource: row.Data[2]?.VarCharValue || '',
          eventTime:   row.Data[3]?.VarCharValue || '',
        };
        output.push(log);
      }

      nextToken = res.NextToken;
    } while (nextToken);

    console.log(`Retrieved ${output.length} log events`);
    return output;
  } catch (err) {
    console.log("Error getting Athena query results", err);
    return [];
  }
};

exports.handler = async (event) => {
  const queryId = event["arguments"]["queryId"];
  console.log("Fetching results for queryExecutionId:", queryId);
  return getQueryResults(queryId);
};
