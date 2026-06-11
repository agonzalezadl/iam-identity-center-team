# © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
# This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
# http: // aws.amazon.com/agreement or other written agreement between Customer and either
# Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
import json
import boto3
import os
import time
from botocore.exceptions import ClientError
from operator import itemgetter
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from requests_aws_sign import AWSV4Sign

client = boto3.client('sso-admin')
s3_client = boto3.client('s3')

ACCOUNT_ID = os.environ['ACCOUNT_ID']
CACHE_TTL = int(os.environ.get('PERMISSIONS_CACHE_TTL', '14400'))
CACHE_BUCKET = os.environ.get('PERMISSIONS_CACHE_BUCKET', f'amplify-teamidcapp-pro-048c2-deployment')
CACHE_KEY = 'team-cache/permission-sets.json'


def publishPermissions(result):
    session = boto3.session.Session()
    credentials = session.get_credentials()
    credentials = credentials.get_frozen_credentials()
    region = session.region_name

    query = """
        mutation PublishPermissions($result: PermissionInput) {
            publishPermissions(result: $result) {
                id
                permissions {
                    Name
                    Arn
                    Duration
                }
            }
        }
    """

    endpoint = os.environ.get("API_TEAM_GRAPHQLAPIENDPOINTOUTPUT", None)
    headers = {"Content-Type": "application/json"}
    payload = {"query": query, "variables": {"result": result}}

    appsync_region = region
    auth = AWSV4Sign(credentials, appsync_region, "appsync")

    try:
        response = requests.post(
            endpoint, auth=auth, json=payload, headers=headers
        ).json()
        if "errors" in response:
            print("Error attempting to query AppSync")
            print(response["errors"])
        else:
            print("Mutation successful")
            print(response)
    except Exception as exception:
        print("Error with Query")
        print(exception)

    return result


def list_existing_sso_instances():
    try:
        response = client.list_instances()
        return response['Instances'][0]
    except ClientError as e:
        print(e.response['Error']['Message'])


sso_instance = list_existing_sso_instances()


def get_mgmt_account_id():
    org_client = boto3.client('organizations')
    try:
        response = org_client.describe_organization()
        return response['Organization']['MasterAccountId']
    except ClientError as e:
        print(e.response['Error']['Message'])


mgmt_account_id = get_mgmt_account_id()


def get_mgmt_ps():
    try:
        p = client.get_paginator('list_permission_sets_provisioned_to_account')
        paginator = p.paginate(
            InstanceArn=sso_instance['InstanceArn'],
            AccountId=mgmt_account_id,
        )
        all_permissions = []
        for page in paginator:
            all_permissions.extend(page["PermissionSets"])
        return set(all_permissions)
    except ClientError as e:
        print(e.response['Error']['Message'])
        return set()


def getPS(ps):
    """Describe un permission set con retry automático en caso de throttling."""
    for attempt in range(3):
        try:
            response = client.describe_permission_set(
                InstanceArn=sso_instance['InstanceArn'],
                PermissionSetArn=ps
            )
            return {
                'Name': response['PermissionSet']['Name'],
                'Arn': response['PermissionSet']['PermissionSetArn'],
                'Duration': None
            }
        except ClientError as e:
            code = e.response['Error']['Code']
            if code == 'ThrottlingException' and attempt < 2:
                time.sleep(2 ** attempt)  # backoff: 1s, 2s
                continue
            print(e.response['Error']['Message'])
            return None


def load_cache():
    """Lee la caché de S3. Retorna (permissions_list, timestamp) o (None, 0) si no existe."""
    try:
        response = s3_client.get_object(Bucket=CACHE_BUCKET, Key=CACHE_KEY)
        cached = json.loads(response['Body'].read().decode('utf-8'))
        return cached.get('permissions', []), cached.get('timestamp', 0)
    except s3_client.exceptions.NoSuchKey:
        return None, 0
    except Exception as e:
        print(f"Error leyendo caché S3: {e}")
        return None, 0


def save_cache(permissions):
    """Guarda la lista de permissions en S3 con timestamp."""
    try:
        value = json.dumps({
            'permissions': permissions,
            'timestamp': int(time.time())
        })
        s3_client.put_object(
            Bucket=CACHE_BUCKET,
            Key=CACHE_KEY,
            Body=value.encode('utf-8'),
            ContentType='application/json'
        )
        print(f"Caché S3 guardada con {len(permissions)} permission sets")
    except Exception as e:
        print(f"Error guardando caché S3: {e}")


def fetch_all_permissions():
    """
    Lista todos los PS usando paralelismo para acelerar los describe_permission_set.
    Reduce de ~86s secuencial a ~5-8s paralelo.
    """
    deployed_in_mgmt = ACCOUNT_ID == mgmt_account_id
    mgmt_ps = get_mgmt_ps() if not deployed_in_mgmt else set()

    # 1. Obtener todos los ARNs (paginado, rápido)
    all_arns = []
    try:
        p = client.get_paginator('list_permission_sets')
        paginator = p.paginate(InstanceArn=sso_instance['InstanceArn'])
        for page in paginator:
            for arn in page['PermissionSets']:
                if deployed_in_mgmt or arn not in mgmt_ps:
                    all_arns.append(arn)
    except ClientError as e:
        print(e.response['Error']['Message'])
        return []

    print(f"Total ARNs a describir: {len(all_arns)}")

    # 2. Describir en paralelo — 3 workers para respetar rate limits de IAM IC
    permissions = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(getPS, arn): arn for arn in all_arns}
        for future in as_completed(futures):
            result = future.result()
            if result:
                permissions.append(result)

    return sorted(permissions, key=itemgetter('Name'))


def handler(event, context):
    print(event)
    id = event['id']

    # 1. Intentar leer desde caché
    cached_permissions, cached_at = load_cache()
    cache_age = int(time.time()) - cached_at

    if cached_permissions and cache_age < CACHE_TTL:
        print(f"Cache HIT — {len(cached_permissions)} PS, edad: {cache_age}s")
        permissions = cached_permissions
    else:
        # 2. Cache MISS — listar y describir en paralelo
        reason = "no existe" if not cached_permissions else f"expirada ({cache_age}s > {CACHE_TTL}s)"
        print(f"Cache MISS ({reason}) — listando permission sets...")
        permissions = fetch_all_permissions()
        save_cache(permissions)

    result = {
        'id': id,
        'permissions': permissions
    }

    return publishPermissions(result)
