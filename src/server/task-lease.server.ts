import type { DatabaseConnection as Pool } from './database.types'

type LeaseDatabase = Pick<Pool, 'query'>

export const DEFAULT_TASK_LEASE_SECONDS = 45

export async function acquireTaskLease(pool: LeaseDatabase, name: string, owner: string, seconds = DEFAULT_TASK_LEASE_SECONDS) {
  const result = await pool.query(
    'INSERT INTO t_platform_job_leader(task_name,owner_id,lease_expires_at,updated_at) ' +
    "VALUES($1,$2,now()+($3 * interval '1 second'),now()) " +
    'ON CONFLICT(task_name) DO UPDATE SET owner_id=EXCLUDED.owner_id,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=now() ' +
    'WHERE t_platform_job_leader.lease_expires_at<=now() OR t_platform_job_leader.owner_id=EXCLUDED.owner_id ' +
    'RETURNING owner_id',
    [name, owner, seconds],
  )
  return result.rowCount === 1
}

export async function renewTaskLease(pool: LeaseDatabase, name: string, owner: string, seconds = DEFAULT_TASK_LEASE_SECONDS) {
  const result = await pool.query(
    "UPDATE t_platform_job_leader SET lease_expires_at=now()+($3 * interval '1 second'),updated_at=now() WHERE task_name=$1 AND owner_id=$2 AND lease_expires_at>now() RETURNING owner_id",
    [name, owner, seconds],
  )
  return result.rowCount === 1
}

export async function releaseTaskLease(pool: LeaseDatabase, name: string, owner: string) {
  await pool.query('DELETE FROM t_platform_job_leader WHERE task_name=$1 AND owner_id=$2', [name, owner])
}
