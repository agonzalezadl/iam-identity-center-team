# © 2023 Amazon Web Services, Inc. or its affiliates. All Rights Reserved.
# This AWS Content is provided subject to the terms of the AWS Customer Agreement available at
# http: // aws.amazon.com/agreement or other written agreement between Customer and either
# Amazon Web Services, Inc. or Amazon Web Services EMEA SARL or both.
import json
import uuid
import os
import boto3
import time

s3_client = boto3.client('s3')

CACHE_BUCKET = os.environ.get('PERMISSIONS_CACHE_BUCKET', 'amplify-teamidcapp-pro-048c2-deployment')
CACHE_KEY = 'team-cache/permission-sets.json'
CACHE_TTL = int(os.environ.get('PERMISSIONS_CACHE_TTL', '14400'))


def load_cache():
    """Lee directamente desde S3 para respuesta inmediata."""
    try:
        response = s3_client.get_object(Bucket=CACHE_BUCKET, Key=CACHE_KEY)
        cached = json.loads(response['Body'].read().decode('utf-8'))
        permissions = cached.get('permissions', [])
        cached_at = cached.get('timestamp', 0)
        cache_age = int(time.time()) - cached_at
        return permissions, cache_age
    except Exception as e:
        print(f"Error leyendo caché S3: {e}")
        return None, 0


def handler(event, context):
    generated_uuid = str(uuid.uuid4())

    # Intentar retornar directamente desde caché S3
    cached_permissions, cache_age = load_cache()

    if cached_permissions and cache_age < CACHE_TTL:
        print(f"Cache HIT directo — {len(cached_permissions)} PS, edad: {cache_age}s")
        return {
            'id': generated_uuid,
            'permissions': cached_permissions
        }

    # Cache MISS o expirada: invocar async para refrescar, retornar vacío temporalmente
    print(f"Cache MISS — disparando refresh async...")
    payload = {"id": generated_uuid}

    lambda_client = boto3.client('lambda')
    invoke_params = {
        'FunctionName': os.environ['FUNCTION_TEAMGETPERMISSIONSETS_NAME'],
        'InvocationType': 'Event',
        'Payload': json.dumps(payload)
    }
    lambda_client.invoke(**invoke_params)

    # Retornar permisos vacíos — el frontend reintentará via subscription
    return payload