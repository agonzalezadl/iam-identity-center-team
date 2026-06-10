# © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
# This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
# http: // aws.amazon.com/agreement or other written agreement between Customer and either
# Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
from botocore.exceptions import ClientError
import boto3
from operator import itemgetter
from datetime import datetime


def sanitize(obj):
    """Recursively convert non-JSON-serializable types (e.g. datetime) to strings."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(i) for i in obj]
    return obj


def get_identiy_store_id():
    client = boto3.client('sso-admin')
    try:
        response = client.list_instances()
        return response['Instances'][0]['IdentityStoreId']
    except ClientError as e:
        print(e.response['Error']['Message'])


sso_instance = get_identiy_store_id()
        
def list_idc_users(IdentityStoreId):
    try:
        client = boto3.client('identitystore')
        p = client.get_paginator('list_users')
        paginator = p.paginate(IdentityStoreId=IdentityStoreId)
        all_users = []
        for page in paginator:
            all_users.extend(page["Users"])
        users = sorted(all_users, key=itemgetter('UserName'))
        return sanitize(users)
    except ClientError as e:
        print(e.response['Error']['Message'])


def handler(event, context):
    return list_idc_users(sso_instance)
