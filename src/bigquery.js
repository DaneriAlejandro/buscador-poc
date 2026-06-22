import { BigQuery } from '@google-cloud/bigquery';

export async function fetchRows(config) {
  const client = new BigQuery({
    projectId: config.projectId,
    credentials: config.credentials,
  });

  const [job] = await client.createQueryJob({
    query: config.query,
    location: config.location,
  });

  const [rows] = await job.getQueryResults();
  return rows;
}
