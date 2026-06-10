
# © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
# This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
# http: // aws.amazon.com/agreement or other written agreement between Customer and either
# Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
import boto3
from botocore.exceptions import ClientError
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


def list_idc_group_membership(groupId):
    try:
        client = boto3.client('identitystore')
        p = client.get_paginator('list_group_memberships')
        paginator = p.paginate(IdentityStoreId=sso_instance,
        GroupId=groupId,
        )
        all_groups = []
        for page in paginator:
            all_groups.extend(page["GroupMemberships"])
        return sanitize(all_groups)
    except ClientError as e:
        print(e.response['Error']['Message'])
        
def handler(event, context):
    members = []
    groupIds = event["arguments"]["groupIds"]
    for groupId in groupIds:
        members.extend(list_idc_group_membership(groupId))
    return {"members": members}